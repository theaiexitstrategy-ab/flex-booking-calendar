import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { full_name, email, phone, segment, instagram, source } = req.body

    const { data, error } = await supabase
      .from('contacts_master')
      .upsert({
        full_name,
        email,
        phone,
        segment: segment || 'athlete',
        instagram: instagram || null,
        source: source || 'booking-calendar',
        created_at: new Date().toISOString()
      }, { onConflict: 'email' })
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, data })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}
