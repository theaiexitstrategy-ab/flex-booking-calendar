var supabaseAdmin = require('../lib/supabaseAdmin')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  var cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    var result = await supabaseAdmin
      .from('bookings')
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
      var bookingDateStr = b.booking_date || ''
      var phone = b.phone || ''
      var name = b.lead_name || ''
      var firstName = name.split(' ')[0] || ''

      if (!bookingDateStr || !phone) continue

      // Parse booking_date which is stored as "APR 5, 2026 7:00 PM"
      var bookingDate = new Date(bookingDateStr)
      if (isNaN(bookingDate.getTime())) continue

      var hoursUntil = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60)
      var manageUrl = baseUrl + '/manage.html?id=' + b.id

      // Parse date and time parts for SMS
      var parts = bookingDateStr.match(/^(\w+ \d+, \d{4})\s*(.*)$/)
      var bDate = parts ? parts[1] : bookingDateStr
      var bTime = parts ? parts[2] : ''

      // 24-hour reminder
      if (hoursUntil >= 23 && hoursUntil <= 25 && !b.reminder_24h_sent) {
        var smsResult = await sendSms({
          to: phone,
          body: 'Hey ' + firstName + '! \uD83D\uDD14 Reminder: Your session at The Flex Facility is TOMORROW \u2014 ' + bDate + ' at ' + bTime + '. Get ready to put in work!\n\nNeed to reschedule or cancel? ' + manageUrl,
          eventType: 'reminder_24h'
        })

        if (smsResult.success) {
          await supabaseAdmin.from('bookings').update({ reminder_24h_sent: true }).eq('id', b.id)
          sent24h++
        } else {
          errors.push('24h fail for ' + name + ': ' + smsResult.error)
        }
      }

      // 2-hour reminder
      if (hoursUntil >= 1.5 && hoursUntil <= 2.5 && !b.reminder_2h_sent) {
        var smsResult2 = await sendSms({
          to: phone,
          body: 'Hey ' + firstName + '! \u23F0 Your session at The Flex Facility is in 2 HOURS \u2014 ' + bTime + ' today. Coach Kenny is locked in. See you soon! \uD83D\uDCAA\uD83C\uDFFE\n\nNeed to reschedule or cancel? ' + manageUrl,
          eventType: 'reminder_2h'
        })

        if (smsResult2.success) {
          await supabaseAdmin.from('bookings').update({ reminder_2h_sent: true }).eq('id', b.id)
          sent2h++
        } else {
          errors.push('2h fail for ' + name + ': ' + smsResult2.error)
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
