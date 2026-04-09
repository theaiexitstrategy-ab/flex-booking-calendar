var supabaseAdmin = require('../lib/supabaseAdmin')

module.exports = async function handler(req, res) {
  try {
    var result = await supabaseAdmin
      .from('bookings')
      .select('id')
      .limit(1)

    if (result.error) throw result.error

    return res.status(200).json({
      success: true,
      message: 'Supabase connection confirmed',
      data: result.data
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    })
  }
}
