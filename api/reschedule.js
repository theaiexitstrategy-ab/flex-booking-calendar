var supabaseAdmin = require('../lib/supabaseAdmin')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms

// Same wall-clock-in-tz parser as api/bookings.js. Avoids the
// Vercel-UTC default that caused starts_at to lose 5 hours when
// reschedules were submitted as bare "MAY 23, 2026 9:30 AM" strings.
function parseWallClockInTz(input, tz) {
  var MONTHS = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  }
  var m = String(input || '').toUpperCase().match(
    /([A-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/
  )
  if (!m) return new Date(input).toISOString()
  var month = MONTHS[m[1].slice(0, 3)]
  var day = parseInt(m[2], 10)
  var year = parseInt(m[3], 10)
  var hour = parseInt(m[4], 10)
  var min = parseInt(m[5], 10)
  var mer = m[6]
  if (mer === 'PM' && hour < 12) hour += 12
  if (mer === 'AM' && hour === 12) hour = 0
  var naiveUtc = Date.UTC(year, month, day, hour, min, 0)
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
  var parts = {}
  fmt.formatToParts(new Date(naiveUtc)).forEach(function (p) {
    if (p.type !== 'literal') parts[p.type] = p.value
  })
  var asTz = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10) === 24 ? 0 : parseInt(parts.hour, 10),
    parseInt(parts.minute, 10), 0
  )
  var offsetMs = naiveUtc - asTz
  return new Date(naiveUtc + offsetMs).toISOString()
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    var booking_id = req.body.booking_id
    var new_date = req.body.new_date
    var new_time = req.body.new_time

    if (!booking_id || !new_date || !new_time) {
      return res.status(400).json({ error: 'booking_id, new_date, and new_time are required' })
    }

    var fetchResult = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchResult.error || !fetchResult.data) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    var booking = fetchResult.data
    var newBookingDate = new_date + ' ' + new_time

    // Re-open old time slot
    if (booking.lead_id) {
      try {
        await supabaseAdmin
          .from('time_slots')
          .update({ is_available: true, booked_by_lead_id: null })
          .eq('booked_by_lead_id', booking.lead_id)
      } catch (slotErr) {
        console.error('Old slot reopen error (non-blocking):', slotErr.message)
      }
    }

    // Parse new date+time as the calendar's wall-clock time (America/Chicago)
    // and convert to UTC. See api/bookings.js — Vercel runs in UTC by default
    // so the legacy `new Date(...).toISOString()` lost 5 hours.
    var newStartsAt = parseWallClockInTz(new_date + ' ' + new_time, 'America/Chicago')

    var updateResult = await supabaseAdmin
      .from('bookings')
      .update({
        booking_date: newBookingDate,
        starts_at: newStartsAt,
        status: 'Confirmed',
        reminder_24h_sent: false,
        reminder_2h_sent: false
      })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateResult.error) throw updateResult.error

    // Block new time slot
    if (booking.lead_id && booking.client_id) {
      try {
        await supabaseAdmin
          .from('time_slots')
          .update({ is_available: false, booked_by_lead_id: booking.lead_id })
          .eq('client_id', booking.client_id)
          .eq('slot_date', new_date)
          .eq('slot_time', new_time)
      } catch (slotErr) {
        console.error('New slot block error (non-blocking):', slotErr.message)
      }
    }

    var phone = booking.phone || ''
    var name = booking.lead_name || ''
    var firstName = name.split(' ')[0] || ''
    var baseUrl = process.env.SITE_URL || 'https://book.theflexfacility.com'
    var manageUrl = baseUrl + '/manage.html?id=' + booking_id

    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: 'Hi ' + firstName + '! Your appointment has been rescheduled to ' + new_date + ' at ' + new_time + '. Questions? Call 1-877-515-FLEX \uD83D\uDC4A\uD83C\uDFFE\n\nManage booking: ' + manageUrl,
          eventType: 'reschedule'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || '3149102203',
          body: 'Reschedule: ' + name.trim() + ' moved to ' + new_date + ' at ' + new_time + '. View in portal: portal.goelev8.ai',
          eventType: 'reschedule'
        })
      ])
    } catch (smsErr) {
      console.error('Reschedule SMS error (non-blocking):', smsErr)
    }

    return res.status(200).json({
      success: true,
      message: 'Booking rescheduled and SMS sent',
      data: updateResult.data
    })
  } catch (err) {
    console.error('Reschedule API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
