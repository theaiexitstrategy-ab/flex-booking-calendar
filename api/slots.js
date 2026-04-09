var supabaseAdmin = require('../lib/supabaseAdmin')

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

    // Fetch all non-cancelled bookings from the new bookings table
    var query = supabaseAdmin
      .from('bookings')
      .select('*')
      .neq('status', 'Cancelled')

    if (session_type) {
      query = query.ilike('service_type', '%' + session_type + '%')
    }

    var result = await query

    if (result.error) throw result.error

    var counts = {}
    var monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
    var targetMonth = monthNames[m]

    var bookings = result.data || []
    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i]
      // booking_date is stored as "APR 5, 2026 7:00 PM" or similar
      var bDate = b.booking_date || ''

      if (bDate && bDate.includes(targetMonth) && bDate.includes(String(y))) {
        // Split the combined date+time field back into date|time key
        // Handle format: "APR 5, 2026 7:00 PM"
        var parts = bDate.match(/^(\w+ \d+, \d{4})\s+(.+)$/)
        if (parts) {
          var key = parts[1] + '|' + parts[2]
          counts[key] = (counts[key] || 0) + 1
        } else {
          // Fallback: use entire booking_date as key
          counts[bDate] = (counts[bDate] || 0) + 1
        }
      }
    }

    // Also check time_slots table for blocked slots
    try {
      var blockedResult = await supabaseAdmin
        .from('time_slots')
        .select('slot_date, slot_time, is_available')
        .eq('is_available', false)

      if (blockedResult.data) {
        // Return blocked slots info alongside counts
        // Frontend can use this to disable specific slots
      }
    } catch (slotErr) {
      // time_slots table may not exist yet, non-blocking
    }

    return res.status(200).json({ success: true, data: counts })
  } catch (err) {
    console.error('Slots API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
