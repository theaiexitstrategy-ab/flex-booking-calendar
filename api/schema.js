var supabase = require('../lib/supabase')

module.exports = async function handler(req, res) {
  try {
    // Get one row from each table to see column names
    var bookingsResult = await supabase
      .from('bookings_master')
      .select('*')
      .limit(0)

    var contactsResult = await supabase
      .from('contacts_master')
      .select('*')
      .limit(1)

    // Also try to get column info via a dummy insert that will fail
    // but reveal column names in the error
    var testInsert = await supabase
      .from('bookings_master')
      .insert({ _probe_: true })
      .select()

    return res.status(200).json({
      bookings_columns: bookingsResult.error ? bookingsResult.error.message : 'no error - check data',
      bookings_data: bookingsResult.data,
      contacts_columns: contactsResult.error ? contactsResult.error.message : 'no error - check data',
      contacts_data: contactsResult.data,
      probe_error: testInsert.error ? testInsert.error.message : 'no error'
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
