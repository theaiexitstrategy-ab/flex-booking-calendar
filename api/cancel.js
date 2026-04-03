const supabase = require('../lib/supabase')
const { sendSms } = require('./utils/sendSms')

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { booking_id } = req.body

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required' })
    }

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings_master')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchErr || !booking) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    const { data: updated, error: updateErr } = await supabase
      .from('bookings_master')
      .update({
        status: 'Cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateErr) throw updateErr

    const firstName = booking.contact_name.split(' ')[0]

    try {
      await Promise.all([
        sendSms({
          to: booking.contact_phone,
          body: `Hey ${firstName}, your session at The Flex Facility on ${booking.booking_date} has been cancelled. Want to rebook? Head to book.theflexfacility.com 🙌🏾`,
          eventType: 'cancel'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || booking.contact_phone,
          body: `Cancellation: ${booking.contact_name} cancelled their ${booking.booking_date} at ${booking.booking_time} session.`,
          eventType: 'cancel'
        })
      ])
    } catch (smsErr) {
      console.error('Cancel SMS error (non-blocking):', smsErr)
    }

    return res.status(200).json({
      success: true,
      message: 'Booking cancelled and SMS sent',
      data: updated
    })
  } catch (err) {
    console.error('Cancel API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
