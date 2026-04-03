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
    const {
      session_type, session_name, date, time,
      name, phone, email, age, sport, goal,
      guardian, instagram, source, timestamp
    } = req.body

    const segment = (session_type === 'lifestyle' || session_type === 'body')
      ? 'lifestyle' : 'athlete'
    const firstName = name.split(' ')[0]

    // 1. Upsert contact into contacts_master
    const { data: contact, error: contactErr } = await supabase
      .from('contacts_master')
      .upsert({
        full_name: name,
        email,
        phone: formatE164(phone),
        segment,
        instagram: instagram || null,
        source: source || 'booking-calendar',
        created_at: timestamp || new Date().toISOString()
      }, { onConflict: 'email' })
      .select()
      .single()

    if (contactErr) console.error('Contact upsert error:', contactErr)

    // 2. Insert booking into bookings_master
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings_master')
      .insert({
        contact_name: name,
        contact_email: email,
        contact_phone: formatE164(phone),
        contact_id: contact?.id || null,
        session_type,
        session_name,
        booking_date: date,
        booking_time: time,
        status: 'Scheduled',
        segment,
        age: age || null,
        sport: sport || null,
        goal: goal || null,
        guardian: guardian || null,
        instagram: instagram || null,
        source: source || 'booking-calendar',
        created_at: timestamp || new Date().toISOString()
      })
      .select()
      .single()

    if (bookingErr) throw bookingErr

    // 3. Send confirmation SMS (fire-and-forget — never break the booking flow)
    try {
      await Promise.all([
        sendSms({
          to: phone,
          body: `Hey ${firstName}! 👊🏾 Your session at The Flex Facility is confirmed for ${date} at ${time}. Coach Kenny is ready to work. Reply STOP to opt out.`,
          eventType: 'booking'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || phone,
          body: `New booking: ${name} — ${date} at ${time}. Service: ${session_name}. Phone: ${phone}.`,
          eventType: 'booking'
        })
      ])
    } catch (smsErr) {
      console.error('Booking SMS error (non-blocking):', smsErr)
    }

    return res.status(201).json({
      success: true,
      message: 'Booking saved and confirmation SMS sent',
      data: { booking_id: booking.id, contact_id: contact?.id }
    })
  } catch (err) {
    console.error('Booking API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
