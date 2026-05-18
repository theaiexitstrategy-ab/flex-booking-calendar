var supabaseAdmin = require('../lib/supabaseAdmin')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms
var formatE164 = smsUtils.formatE164

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

// Parse a wall-clock string ("MAY 23, 2026 9:30 AM") as if it were in
// the given IANA timezone, return ISO UTC. Used to store starts_at so
// the slot the customer picked on the public calendar lines up with
// the calendar's tz (America/Chicago) regardless of where the
// serverless function runs (Vercel = UTC).
//
// Strategy: parse the date parts manually (year, month, day, hour,
// minute, am/pm), build a Date in UTC, then ask Intl.DateTimeFormat
// what UTC offset that wall-clock would carry in the target tz at
// that moment — and subtract that offset to land on the correct UTC.
function parseWallClockInTz(input, tz) {
  var MONTHS = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  }
  var m = String(input || '').toUpperCase().match(
    /([A-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/
  )
  if (!m) return new Date(input).toISOString()  // fallback to legacy behavior
  var month = MONTHS[m[1].slice(0, 3)]
  var day   = parseInt(m[2], 10)
  var year  = parseInt(m[3], 10)
  var hour  = parseInt(m[4], 10)
  var min   = parseInt(m[5], 10)
  var mer   = m[6]
  if (mer === 'PM' && hour < 12) hour += 12
  if (mer === 'AM' && hour === 12) hour = 0
  // Naive UTC interpretation of the wall-clock.
  var naiveUtc = Date.UTC(year, month, day, hour, min, 0)
  // What UTC offset (in minutes) does that wall-clock carry in the
  // target tz? Format the naive timestamp in tz and read back the parts.
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
    parseInt(parts.minute, 10),
    0
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
    var body = req.body
    var name = body.name || ''
    var phone = body.phone || ''
    var email = body.email || ''
    var session_type = body.session_type || 'athlete'
    var session_name = body.session_name || ''
    var date = body.date || ''
    var time = body.time || ''
    var firstName = name.split(' ')[0] || ''
    var phoneE164 = formatE164(phone)

    // Look up flex-facility client_id
    var clientId = null
    try {
      var clientResult = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('slug', FLEX_FACILITY_SLUG)
        .maybeSingle()
      if (clientResult.data) clientId = clientResult.data.id
      if (!clientId) console.log('No client found for slug:', FLEX_FACILITY_SLUG)
    } catch (ce) {
      console.error('Client lookup error:', ce.message)
    }

    // ── STEP 1: Insert into bookings table ──
    var bookingDate = date + ' ' + time
    // Parse date+time as the calendar's wall-clock time (The Flex
    // Facility runs on America/Chicago) and convert to UTC for storage.
    // Previously we used `new Date(date + ' ' + time).toISOString()`,
    // which parsed the string in the server's local tz — Vercel
    // functions run in UTC, so "9:30 AM" was stored as 09:30 UTC
    // instead of 14:30 UTC (9:30 AM CDT). Result: every booking
    // displayed 5 hours earlier than the slot the customer actually
    // picked.
    var startsAt = parseWallClockInTz(date + ' ' + time, 'America/Chicago')

    var bookingPayload = {
      lead_name: name,
      phone: phoneE164,
      email: email,
      booking_date: bookingDate,
      service: session_name || session_type,
      service_type: session_name || session_type,
      starts_at: startsAt,
      status: 'Confirmed',
      source: 'book.theflexfacility.com',
      created_at: new Date().toISOString()
    }
    // Only include client_id if we found one (avoids NOT NULL constraint errors)
    if (clientId) bookingPayload.client_id = clientId

    var bookingResult = await supabaseAdmin
      .from('bookings')
      .insert(bookingPayload)
      .select()
      .single()

    if (bookingResult.error) {
      console.error('Booking insert error:', JSON.stringify(bookingResult.error))
      throw new Error(bookingResult.error.message || 'Failed to insert booking')
    }

    var bookingRow = bookingResult.data
    var bookingId = bookingRow ? bookingRow.id : ''

    // ── STEP 2: Upsert into leads table ──
    var leadId = null
    try {
      // Check if phone already exists in leads
      var existingLead = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('phone', phoneE164)
        .maybeSingle()

      if (existingLead.data) {
        // Update existing lead status
        leadId = existingLead.data.id
        await supabaseAdmin
          .from('leads')
          .update({
            status: 'Ready to Book',
            name: name,
            email: email
          })
          .eq('id', leadId)
      } else {
        // Insert new lead
        var leadPayload = {
          name: name,
          phone: phoneE164,
          email: email,
          source: 'book.theflexfacility.com',
          funnel: 'booking',
          status: 'Ready to Book',
          tags: ['ready-to-book'],
          created_at: new Date().toISOString()
        }
        if (clientId) leadPayload.client_id = clientId

        var leadResult = await supabaseAdmin
          .from('leads')
          .insert(leadPayload)
          .select('id')
          .single()
        if (leadResult.data) leadId = leadResult.data.id
      }
    } catch (le) {
      console.error('Lead upsert error:', le.message)
    }

    // Update booking with lead_id if available
    if (leadId && bookingId) {
      await supabaseAdmin
        .from('bookings')
        .update({ lead_id: leadId })
        .eq('id', bookingId)
        .then(function() {})
        .catch(function(err) { console.error('Booking lead_id update error:', err) })
    }

    // Mark time slot as unavailable if time_slots table exists
    try {
      await supabaseAdmin
        .from('time_slots')
        .update({
          is_available: false,
          booked_by_lead_id: leadId
        })
        .eq('client_id', clientId)
        .eq('slot_date', date)
        .eq('slot_time', time)
    } catch (slotErr) {
      console.error('Slot update error (non-blocking):', slotErr.message)
    }

    // ── STEP 3: POST to GoElev8 portal webhook ──
    try {
      var webhookSecret = process.env.GOELEV8_WEBHOOK_SECRET
      if (webhookSecret) {
        await fetch('https://portal.goelev8.ai/api/webhooks/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goelev8-secret': webhookSecret
          },
          body: JSON.stringify({
            slug: FLEX_FACILITY_SLUG,
            name: name,
            phone: phoneE164,
            email: email,
            source: 'book.theflexfacility.com',
            funnel: 'booking',
            metadata: {
              booking_date: bookingDate,
              service_type: session_name || session_type
            }
          })
        })
      }
    } catch (whErr) {
      console.error('GoElev8 webhook error (non-blocking):', whErr.message)
    }

    // ── STEP 4 & 5: Send Twilio SMS ──
    var baseUrl = process.env.SITE_URL || 'https://book.theflexfacility.com'
    var manageUrl = baseUrl + '/manage.html?id=' + bookingId

    try {
      await Promise.all([
        // STEP 4: SMS to booker
        sendSms({
          to: phone,
          body: 'Hi ' + firstName + '! Your appointment with The Flex Facility is confirmed for ' + date + ' at ' + time + '. Questions? Call or text 1-877-515-FLEX \uD83D\uDC4A\uD83C\uDFFE\n- Coach Kenny\n\nManage booking: ' + manageUrl + '\n\nReply STOP to opt out.',
          eventType: 'booking'
        }),
        // STEP 5: SMS to Coach Kenny
        sendSms({
          to: process.env.COACH_KENNY_PHONE || '3149102203',
          body: 'New booking! ' + name + ' just booked for ' + date + ' at ' + time + '. View in portal: portal.goelev8.ai',
          eventType: 'booking'
        })
      ])
    } catch (smsErr) {
      console.error('SMS error (non-blocking):', smsErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Booking confirmed — SMS sent',
      data: { booking_id: bookingId, lead_id: leadId }
    })
  } catch (err) {
    console.error('Booking API error:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
}
