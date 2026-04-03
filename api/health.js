import supabase from '../lib/supabase.js'

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase
      .from('contacts_master')
      .select('id')
      .limit(1)

    if (error) throw error

    return res.status(200).json({
      success: true,
      message: 'Supabase connection confirmed',
      data
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    })
  }
}
