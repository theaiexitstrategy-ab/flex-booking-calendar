import supabase from '../lib/supabase.js'
import { sendSms } from './utils/sendSms.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { booking_id, new_date, new_time } = req.body

    if (!booking_id || !new_date || !new_time) {
      return res.status(400).json({ error: 'booking_id, new_date, and new_time are required' })
    }

    // 1. Fetch existing booking
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings_master')
      .select('*')
      .eq('id', booking_id)
      .single()

    if (fetchErr || !booking) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    // 2. Update booking in Supabase
    const { data: updated, error: updateErr } = await supabase
      .from('bookings_master')
      .update({
        booking_date: new_date,
        booking_time: new_time,
        status: 'Rescheduled',
        updated_at: new Date().toISOString()
      })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateErr) throw updateErr

    const firstName = booking.contact_name.split(' ')[0]

    // 3. Send reschedule SMS (fire-and-forget)
    try {
      await Promise.all([
        sendSms({
          to: booking.contact_phone,
          body: `Hey ${firstName}! Your session at The Flex Facility has been rescheduled to ${new_date} at ${new_time}. See you then! 💪🏾`,
          eventType: 'reschedule'
        }),
        sendSms({
          to: process.env.COACH_KENNY_PHONE || booking.contact_phone,
          body: `Reschedule: ${booking.contact_name} moved to ${new_date} at ${new_time}.`,
          eventType: 'reschedule'
        })
      ])
    } catch (smsErr) {
      console.error('Reschedule SMS error (non-blocking):', smsErr)
    }

    return res.status(200).json({
      success: true,
      message: 'Booking rescheduled and SMS sent',
      data: updated
    })
  } catch (err) {
    console.error('Reschedule API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
