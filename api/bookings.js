import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  // Allow CORS for the booking calendar
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body
    const {
      session_type,
      session_name,
      date,
      time,
      name,
      phone,
      email,
      age,
      sport,
      goal,
      guardian,
      instagram,
      source,
      timestamp
    } = body

    // Determine segment from session type
    const segment = (session_type === 'lifestyle' || session_type === 'body')
      ? 'lifestyle' : 'athlete'

    // 1. Upsert contact into contacts_master
    const { data: contact, error: contactErr } = await supabase
      .from('contacts_master')
      .upsert({
        full_name: name,
        email: email,
        phone: phone,
        segment: segment,
        instagram: instagram || null,
        source: source || 'booking-calendar',
        created_at: timestamp || new Date().toISOString()
      }, { onConflict: 'email' })
      .select()
      .single()

    if (contactErr) {
      console.error('Contact upsert error:', contactErr)
      // Continue anyway — booking is more important
    }

    // 2. Insert booking into bookings_master
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings_master')
      .insert({
        contact_name: name,
        contact_email: email,
        contact_phone: phone,
        contact_id: contact?.id || null,
        session_type: session_type,
        session_name: session_name,
        booking_date: date,
        booking_time: time,
        status: 'Scheduled',
        segment: segment,
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

    return res.status(201).json({
      success: true,
      message: 'Booking saved to Supabase',
      data: { booking_id: booking.id, contact_id: contact?.id }
    })
  } catch (err) {
    console.error('Booking API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
