var supabaseAdmin = require('../../lib/supabaseAdmin')
var bookingWindow = require('../utils/bookingWindow')

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Look up client_id for flex-facility
    var clientId = null
    var clientResult = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('slug', FLEX_FACILITY_SLUG)
      .maybeSingle()

    if (clientResult.data) clientId = clientResult.data.id

    // Earliest bookable date in Central time — today is excluded because
    // same-day booking isn't allowed. (Was `new Date()` in the server's
    // tz, which on Vercel is UTC and rolls a day early after 7pm CT.)
    var earliest = bookingWindow.minBookableIso()

    var query = supabaseAdmin
      .from('time_slots')
      .select('id, slot_date, slot_time, is_available, booked_by_lead_id')
      .eq('is_available', true)
      .gte('slot_date', earliest)
      .order('slot_date', { ascending: true })
      .order('slot_time', { ascending: true })

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    var result = await query

    if (result.error) throw result.error

    return res.status(200).json({
      success: true,
      data: result.data || []
    })
  } catch (err) {
    console.error('Available slots API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
