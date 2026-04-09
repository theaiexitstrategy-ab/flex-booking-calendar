var supabaseAdmin = require('../lib/supabaseAdmin')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  var id = req.query.id
  if (!id) {
    return res.status(400).json({ success: false, error: 'Booking ID required' })
  }

  try {
    var result = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single()

    if (result.error) throw result.error

    return res.status(200).json({ success: true, data: result.data })
  } catch (err) {
    return res.status(404).json({ success: false, error: 'Booking not found' })
  }
}
