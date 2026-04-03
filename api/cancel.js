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

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required' })
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
      .update({ status: 'Cancelled' })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateResult.error) throw updateResult.error

    // Get contact info — handle both column naming patterns
    var phone = booking.phone || booking.contact_phone || ''
    var name = booking.first_name ? (booking.first_name + ' ' + (booking.last_name || '')) : (booking.name || booking.contact_name || '')
    var firstName = (booking.first_name || name.split(' ')[0] || '')
    var bDate = booking.booking_date || booking.date || ''
    var bTime = booking.booking_time || booking.time || ''

    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: firstName + '... say it ain\'t so. 😩 Your session at The Flex Facility on ' + bDate + ' has been cancelled and honestly, Coach Kenny is taking it personally.\n\nWe had the playlist ready. The energy was set. Your gains were THIS close. 😤\n\nLook, life happens — but your comeback doesn\'t have to wait. Reschedule right now and let\'s get back to work: book.theflexfacility.com\n\nThe FLEX Facility misses you already. 💪🏾\n\nReply STOP to opt out.',
          eventType: 'cancel'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || phone,
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
