// Returns upcoming one-off date blackouts for The Flex Facility.
//
// The widget calls this once on calendar render and uses the result to
// mark blocked dates as unavailable in the calendar grid. Source of
// truth is the booking_blocked_dates table on the portal Supabase,
// managed via portal.goelev8.ai → Bookings → Days Off.
//
// Response shape:
//   {
//     success: true,
//     blocks: [
//       { date: '2026-06-08', start_time: null,  end_time: null,  reason: 'Closed' },
//       { date: '2026-06-09', start_time: '09:00', end_time: '12:00', reason: 'Half day' }
//     ]
//   }
// start_time/end_time null = entire day blocked.

var supabaseAdmin = require('../lib/supabaseAdmin')

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Short cache (15s) so an operator marking a day off in the portal
  // sees the booking widget update almost immediately on next render.
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    var clientResult = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('slug', FLEX_FACILITY_SLUG)
      .maybeSingle()

    if (!clientResult.data) {
      return res.status(200).json({ success: true, blocks: [] })
    }
    var clientId = clientResult.data.id

    var today = new Date().toISOString().slice(0, 10)
    var result = await supabaseAdmin
      .from('booking_blocked_dates')
      .select('blocked_date, start_time, end_time, reason')
      .eq('client_id', clientId)
      .gte('blocked_date', today)
      .order('blocked_date', { ascending: true })

    // Tolerate "table missing" before the portal migration has been
    // run — the calendar should still render normally without blocks
    // instead of 500-ing on every page load.
    if (result.error) {
      if (/booking_blocked_dates|does not exist|schema cache/i.test(result.error.message || '')) {
        return res.status(200).json({ success: true, blocks: [], pending_migration: true })
      }
      throw result.error
    }

    var blocks = (result.data || []).map(function (r) {
      return {
        date:       r.blocked_date,
        start_time: r.start_time,
        end_time:   r.end_time,
        reason:     r.reason
      }
    })

    return res.status(200).json({ success: true, blocks: blocks })
  } catch (err) {
    console.error('Blocked dates API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
