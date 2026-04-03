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
    var month = req.query.month
    var year = req.query.year
    var session_type = req.query.session_type

    if (month === undefined || year === undefined) {
      return res.status(400).json({ error: 'month and year query params required' })
    }

    var m = parseInt(month)
    var y = parseInt(year)

    var query = supabase
      .from('bookings_master')
      .select('booking_date, booking_time, session_type')
      .neq('status', 'Cancelled')

    if (session_type) {
      query = query.eq('session_type', session_type)
    }

    var result = await query

    if (result.error) throw result.error

    var counts = {}
    var monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
    var targetMonth = monthNames[m]

    var bookings = result.data || []
    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i]
      if (b.booking_date && b.booking_date.includes(targetMonth) && b.booking_date.includes(String(y))) {
        var key = b.booking_date + '|' + b.booking_time
        counts[key] = (counts[key] || 0) + 1
      }
    }

    return res.status(200).json({ success: true, data: counts })
  } catch (err) {
    console.error('Slots API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
