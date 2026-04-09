var supabaseAdmin = require('../../lib/supabaseAdmin')

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

    var today = new Date().toISOString().split('T')[0]

    var query = supabaseAdmin
      .from('time_slots')
      .select('id, slot_date, slot_time, is_available, booked_by_lead_id')
      .eq('is_available', true)
      .gte('slot_date', today)
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
