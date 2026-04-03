import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { month, year, session_type } = req.query

    if (!month || !year) {
      return res.status(400).json({ error: 'month and year query params required' })
    }

    // Build date range for the requested month
    const m = parseInt(month)
    const y = parseInt(year)
    const startDate = new Date(y, m, 1)
    const endDate = new Date(y, m + 1, 0, 23, 59, 59)

    // Query bookings for this month that aren't cancelled
    let query = supabase
      .from('bookings_master')
      .select('booking_date, booking_time, session_type')
      .neq('status', 'Cancelled')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())

    if (session_type) {
      query = query.eq('session_type', session_type)
    }

    const { data: bookings, error } = await query

    if (error) throw error

    // Count bookings per date+time combo
    // Returns: { "Apr 5, 2026|7:00 PM": 3, "Apr 5, 2026|8:00 PM": 1, ... }
    const counts = {}
    for (const b of (bookings || [])) {
      const key = `${b.booking_date}|${b.booking_time}`
      counts[key] = (counts[key] || 0) + 1
    }

    return res.status(200).json({ success: true, data: counts })
  } catch (err) {
    console.error('Slots API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
