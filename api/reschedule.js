var supabaseAdmin = require('../lib/supabaseAdmin')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms

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

    // Parse new date+time into ISO timestamp for portal's starts_at column
    var newStartsAt = new Date(new_date + ' ' + new_time).toISOString()

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
