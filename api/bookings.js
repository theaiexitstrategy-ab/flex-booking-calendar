const supabase = require('../lib/supabase')
const { sendSms, formatE164 } = require('./utils/sendSms')

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
    var name = body.name
    var phone = body.phone
    var email = body.email
    var session_type = body.session_type
    var session_name = body.session_name
    var date = body.date
    var time = body.time
    var segment = (session_type === 'lifestyle' || session_type === 'body')
      ? 'lifestyle' : 'athlete'
    var firstName = name.split(' ')[0]
    var phoneE164 = formatE164(phone)

    // 1. Upsert contact into contacts_master (only core fields)
    var contactId = null
    try {
      var contactResult = await supabase
        .from('contacts_master')
        .upsert({
          full_name: name,
          email: email,
          phone: phoneE164,
          segment: segment
        }, { onConflict: 'email' })
        .select('id')
        .single()

      if (contactResult.data) contactId = contactResult.data.id
      if (contactResult.error) console.error('Contact upsert error:', contactResult.error)
    } catch (contactErr) {
      console.error('Contact upsert exception:', contactErr)
    }

    // 2. Insert booking into bookings_master (only core fields)
    var bookingData = {
      contact_name: name,
      contact_email: email,
      contact_phone: phoneE164,
      session_type: session_type,
      session_name: session_name,
      booking_date: date,
      booking_time: time,
      status: 'Scheduled',
      segment: segment
    }

    // Add contact_id only if we got one
    if (contactId) bookingData.contact_id = contactId

    var bookingResult = await supabase
      .from('bookings_master')
      .insert(bookingData)
      .select()
      .single()

    if (bookingResult.error) throw bookingResult.error

    var booking = bookingResult.data

    // 3. Send confirmation SMS (fire-and-forget)
    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: 'Hey ' + firstName + '! 👊🏾 Your session at The Flex Facility is confirmed for ' + date + ' at ' + time + '. Coach Kenny is ready to work. Reply STOP to opt out.',
          eventType: 'booking'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || phone,
          body: 'New booking: ' + name + ' — ' + date + ' at ' + time + '. Service: ' + session_name + '. Phone: ' + phone + '.',
          eventType: 'booking'
        })
      ])
    } catch (smsErr) {
      console.error('Booking SMS error (non-blocking):', smsErr)
    }

    return res.status(201).json({
      success: true,
      message: 'Booking saved and confirmation SMS sent',
      data: { booking_id: booking.id, contact_id: contactId }
    })
  } catch (err) {
    console.error('Booking API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
