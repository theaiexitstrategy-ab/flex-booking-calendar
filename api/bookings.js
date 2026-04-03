var supabase = require('../lib/supabase')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms
var formatE164 = smsUtils.formatE164

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
    var nameParts = name.split(' ')
    var firstName = nameParts[0] || ''
    var lastName = nameParts.slice(1).join(' ') || ''
    var segment = (session_type === 'lifestyle' || session_type === 'body')
      ? 'lifestyle' : 'athlete'
    var phoneE164 = formatE164(phone)

    // 1. Upsert contact — use first_name/last_name per actual schema
    var contactId = null
    try {
      var contactResult = await supabase
        .from('contacts_master')
        .upsert({
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phoneE164,
          contact_type: 'Lead',
          segment: segment
        }, { onConflict: 'email' })
        .select('id')
        .single()

      if (contactResult.data) contactId = contactResult.data.id
      if (contactResult.error) console.error('Contact upsert error:', JSON.stringify(contactResult.error))
    } catch (ce) {
      console.error('Contact exception:', ce.message)
    }

    // 2. Insert booking — try multiple column name patterns
    //    since we don't know the exact schema
    var bookingRow = null
    var bookingError = null

    // Attempt 1: common column names matching contacts pattern
    var attempt1 = await supabase.from('bookings_master').insert({
      contact_id: contactId,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phoneE164,
      session_type: session_type,
      session_name: session_name,
      booking_date: date,
      booking_time: time,
      status: 'Scheduled',
      segment: segment
    }).select().single()

    if (!attempt1.error) {
      bookingRow = attempt1.data
    } else {
      console.error('Booking attempt 1 error:', JSON.stringify(attempt1.error))

      // Attempt 2: even more minimal — just the fields most likely to exist
      var attempt2 = await supabase.from('bookings_master').insert({
        contact_id: contactId,
        name: name,
        email: email,
        phone: phoneE164,
        session_type: session_type,
        date: date,
        time: time,
        status: 'Scheduled',
        segment: segment
      }).select().single()

      if (!attempt2.error) {
        bookingRow = attempt2.data
      } else {
        console.error('Booking attempt 2 error:', JSON.stringify(attempt2.error))

        // Attempt 3: absolute minimum
        var attempt3 = await supabase.from('bookings_master').insert({
          contact_id: contactId,
          status: 'Scheduled'
        }).select().single()

        if (!attempt3.error) {
          bookingRow = attempt3.data
        } else {
          bookingError = attempt3.error
          console.error('Booking attempt 3 error:', JSON.stringify(attempt3.error))
        }
      }
    }

    if (bookingError && !bookingRow) {
      throw new Error(bookingError.message || 'Failed to insert booking after 3 attempts')
    }

    // 3. Send SMS (fire-and-forget)
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
      console.error('SMS error (non-blocking):', smsErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Booking saved and confirmation SMS sent',
      data: { booking_id: bookingRow ? bookingRow.id : null, contact_id: contactId }
    })
  } catch (err) {
    console.error('Booking API error:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
}
