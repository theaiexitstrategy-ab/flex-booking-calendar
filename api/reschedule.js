const supabase = require('../lib/supabase')
const { sendSms } = require('./utils/sendSms')

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

    var fetchResult = await supabase
      .from('bookings_master')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchResult.error || !fetchResult.data) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    var booking = fetchResult.data

    var updateResult = await supabase
      .from('bookings_master')
      .update({
        booking_date: new_date,
        booking_time: new_time,
        status: 'Rescheduled',
        updated_at: new Date().toISOString()
      })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateResult.error) throw updateResult.error

    var firstName = booking.contact_name.split(' ')[0]

    try {
      await Promise.all([
        sendSms({
          to: booking.contact_phone,
          body: 'Hey ' + firstName + '! Your session at The Flex Facility has been rescheduled to ' + new_date + ' at ' + new_time + '. See you then! 💪🏾',
          eventType: 'reschedule'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || booking.contact_phone,
          body: 'Reschedule: ' + booking.contact_name + ' moved to ' + new_date + ' at ' + new_time + '.',
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
