var supabase = require('../lib/supabase')

module.exports = async function handler(req, res) {
  try {
    // Query information_schema to get actual column names
    var bookingsCols = await supabase.rpc('get_columns', { table_name_param: 'bookings_master' })

    // Fallback: try a direct SQL-style approach via postgrest
    var bookingsResult = await supabase
      .from('bookings_master')
      .select('*')
      .limit(0)

    // Try inserting an empty row to force Supabase to list required columns
    var emptyInsert = await supabase
      .from('bookings_master')
      .insert({})

    var contactsResult = await supabase
      .from('contacts_master')
      .select('*')
      .limit(1)

    // Also check sms_log
    var smsLogResult = await supabase
      .from('sms_log')
      .select('*')
      .limit(0)

    return res.status(200).json({
      bookings_rpc: bookingsCols.error ? bookingsCols.error.message : bookingsCols.data,
      bookings_empty_insert_error: emptyInsert.error ? emptyInsert.error.message : 'success',
      contacts_sample: contactsResult.data,
      contacts_error: contactsResult.error ? contactsResult.error.message : null,
      sms_log_error: smsLogResult.error ? smsLogResult.error.message : 'table exists',
      sms_log_data: smsLogResult.data
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
