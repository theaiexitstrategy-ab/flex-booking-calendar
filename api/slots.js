const supabase = require('../lib/supabase')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { month, year, session_type } = req.query

    if (month === undefined || year === undefined) {
      return res.status(400).json({ error: 'month and year query params required' })
    }

    const m = parseInt(month)
    const y = parseInt(year)

    // Query all non-cancelled bookings for this month
    let query = supabase
      .from('bookings_master')
      .select('booking_date, booking_time, session_type')
      .neq('status', 'Cancelled')

    if (session_type) {
      query = query.eq('session_type', session_type)
    }

    const { data: bookings, error } = await query

    if (error) throw error

    // Count bookings per date+time combo
    const counts = {}
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
    const targetMonth = monthNames[m]

    for (const b of (bookings || [])) {
      // Only count bookings that match the target month/year
      if (b.booking_date && b.booking_date.includes(targetMonth) && b.booking_date.includes(String(y))) {
        const key = `${b.booking_date}|${b.booking_time}`
        counts[key] = (counts[key] || 0) + 1
      }
    }

    return res.status(200).json({ success: true, data: counts })
  } catch (err) {
    console.error('Slots API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
