var supabase = require('../lib/supabase')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms

module.exports = async function handler(req, res) {
  // This endpoint is called by a cron (Supabase Edge Function or Vercel Cron)
  // It checks for bookings happening in ~24 hours or ~2 hours and sends reminders

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Optional: protect with a secret
  var cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    // Allow without secret if not configured
    if (cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    // Fetch all scheduled/confirmed bookings
    var result = await supabase
      .from('bookings_master')
      .select('*')
      .in('status', ['Scheduled', 'Confirmed', 'Rescheduled'])

    if (result.error) throw result.error

    var bookings = result.data || []
    var now = new Date()
    var sent24h = 0
    var sent2h = 0
    var errors = []
    var baseUrl = process.env.SITE_URL || 'https://book.theflexfacility.com'

    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i]
      var bDate = b.booking_date || b.date || ''
      var bTime = b.booking_time || b.time || ''
      var phone = b.phone || b.contact_phone || ''
      var bName = b.first_name || b.name || b.contact_name || ''
      var firstName = bName.split(' ')[0]

      if (!bDate || !bTime || !phone) continue

      // Parse the booking datetime
      // Date format from calendar: "APR 5, 2026"
      var bookingDate = new Date(bDate + ' ' + bTime)
      if (isNaN(bookingDate.getTime())) continue

      var hoursUntil = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60)
      var manageUrl = baseUrl + '/manage.html?id=' + b.id

      // 24-hour reminder: send between 23-25 hours before
      if (hoursUntil >= 23 && hoursUntil <= 25) {
        var already24 = b.reminder_24h_sent
        if (!already24) {
          var smsResult = await sendSms({
            to: phone,
            body: 'Hey ' + firstName + '! 🔔 Reminder: Your session at The Flex Facility is TOMORROW — ' + bDate + ' at ' + bTime + '. Get ready to put in work!\n\nNeed to reschedule or cancel? ' + manageUrl,
            eventType: 'reminder_24h'
          })

          if (smsResult.success) {
            await supabase.from('bookings_master').update({ reminder_24h_sent: true }).eq('id', b.id)
            sent24h++
          } else {
            errors.push('24h fail for ' + bName + ': ' + smsResult.error)
          }
        }
      }

      // 2-hour reminder: send between 1.5-2.5 hours before
      if (hoursUntil >= 1.5 && hoursUntil <= 2.5) {
        var already2 = b.reminder_2h_sent
        if (!already2) {
          var smsResult2 = await sendSms({
            to: phone,
            body: 'Hey ' + firstName + '! ⏰ Your session at The Flex Facility is in 2 HOURS — ' + bTime + ' today. Coach Kenny is locked in. See you soon! 💪🏾\n\nNeed to reschedule or cancel? ' + manageUrl,
            eventType: 'reminder_2h'
          })

          if (smsResult2.success) {
            await supabase.from('bookings_master').update({ reminder_2h_sent: true }).eq('id', b.id)
            sent2h++
          } else {
            errors.push('2h fail for ' + bName + ': ' + smsResult2.error)
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Reminder check complete',
      total_bookings_checked: bookings.length,
      sent_24h: sent24h,
      sent_2h: sent2h,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (err) {
    console.error('Reminders API error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
