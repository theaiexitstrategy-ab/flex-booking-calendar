var supabase = require('../lib/supabase')
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

    var fetchResult = await supabase
      .from('bookings_master')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchResult.error || !fetchResult.data) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    var booking = fetchResult.data

    // Build update — try both column name patterns
    var updateData = { status: 'Rescheduled' }
    // Set both possible date/time columns
    if (booking.booking_date !== undefined) { updateData.booking_date = new_date; updateData.booking_time = new_time; }
    if (booking.date !== undefined) { updateData.date = new_date; updateData.time = new_time; }
    // If neither existed, set both and let Supabase pick what works
    if (booking.booking_date === undefined && booking.date === undefined) {
      updateData.booking_date = new_date;
      updateData.booking_time = new_time;
    }

    var updateResult = await supabase
      .from('bookings_master')
      .update(updateData)
      .eq('id', booking_id)
      .select()
      .single()

    if (updateResult.error) throw updateResult.error

    // Get contact info — handle both column naming patterns
    var phone = booking.phone || booking.contact_phone || ''
    var name = booking.first_name ? (booking.first_name + ' ' + (booking.last_name || '')) : (booking.name || booking.contact_name || '')
    var firstName = (booking.first_name || name.split(' ')[0] || '')
    var baseUrl = process.env.SITE_URL || 'https://book.theflexfacility.com'
    var manageUrl = baseUrl + '/manage.html?id=' + booking_id

    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: 'Hey ' + firstName + '! Your session at The Flex Facility has been rescheduled to ' + new_date + ' at ' + new_time + '. See you then! 💪🏾\n\nNeed to make another change? ' + manageUrl,
          eventType: 'reschedule'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || phone,
          body: 'Reschedule: ' + name.trim() + ' moved to ' + new_date + ' at ' + new_time + '.',
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
