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

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required' })
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

    var updateResult = await supabaseAdmin
      .from('bookings')
      .update({ status: 'Cancelled' })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateResult.error) throw updateResult.error

    // Re-open the time slot if applicable
    if (booking.lead_id) {
      try {
        await supabaseAdmin
          .from('time_slots')
          .update({ is_available: true, booked_by_lead_id: null })
          .eq('booked_by_lead_id', booking.lead_id)
      } catch (slotErr) {
        console.error('Slot reopen error (non-blocking):', slotErr.message)
      }
    }

    var phone = booking.phone || ''
    var name = booking.lead_name || ''
    var firstName = name.split(' ')[0] || ''
    // Parse date/time from booking_date field ("APR 5, 2026 7:00 PM")
    var bookingDate = booking.booking_date || ''
    var dateParts = bookingDate.match(/^(\w+ \d+, \d{4})\s*(.*)$/)
    var bDate = dateParts ? dateParts[1] : bookingDate
    var bTime = dateParts ? dateParts[2] : ''

    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: 'Hi ' + firstName + ', your appointment at The Flex Facility on ' + bDate + ' has been cancelled. Please call 1-877-515-FLEX to reschedule.',
          eventType: 'cancel'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || '3149102203',
          body: 'Cancellation: ' + name.trim() + ' cancelled their ' + bDate + ' at ' + bTime + ' session.',
          eventType: 'cancel'
        })
      ])
    } catch (smsErr) {
      console.error('Cancel SMS error (non-blocking):', smsErr)
    }

    return res.status(200).json({
      success: true,
      message: 'Booking cancelled and SMS sent',
      data: updateResult.data
    })
  } catch (err) {
    console.error('Cancel API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
