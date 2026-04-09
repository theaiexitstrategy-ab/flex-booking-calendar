var supabaseAdmin = require('../../lib/supabaseAdmin')

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Require service role key in Authorization header for admin-only access
  var authHeader = req.headers.authorization || ''
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!authHeader.includes(serviceKey)) {
    return res.status(401).json({ error: 'Unauthorized — admin access required' })
  }

  try {
    var body = req.body
    var slot_date = body.slot_date
    var slot_time = body.slot_time
    var note = body.note || ''

    if (!slot_date || !slot_time) {
      return res.status(400).json({ error: 'slot_date and slot_time are required' })
    }

    // Look up client_id
    var clientId = null
    var clientResult = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('slug', FLEX_FACILITY_SLUG)
      .maybeSingle()

    if (clientResult.data) clientId = clientResult.data.id

    // Block the slot by setting is_available = false
    // If the slot exists, update it. Otherwise, insert a blocked slot.
    var existing = await supabaseAdmin
      .from('time_slots')
      .select('id')
      .eq('slot_date', slot_date)
      .eq('slot_time', slot_time)
      .eq('client_id', clientId)
      .maybeSingle()

    var result
    if (existing.data) {
      result = await supabaseAdmin
        .from('time_slots')
        .update({ is_available: false })
        .eq('id', existing.data.id)
        .select()
        .single()
    } else {
      result = await supabaseAdmin
        .from('time_slots')
        .insert({
          client_id: clientId,
          slot_date: slot_date,
          slot_time: slot_time,
          is_available: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single()
    }

    if (result.error) throw result.error

    return res.status(200).json({
      success: true,
      message: 'Slot blocked successfully',
      data: result.data
    })
  } catch (err) {
    console.error('Block slot API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
