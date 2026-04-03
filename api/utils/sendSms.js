const supabase = require('../../lib/supabase')

/**
 * Format phone number to E.164 (+1XXXXXXXXXX)
 */
function formatE164(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.startsWith('+')) return phone.replace(/[^\d+]/g, '')
  return `+${digits}`
}

/**
 * Send an SMS via Twilio REST API (no SDK needed)
 */
async function sendSms({ to, body, eventType = 'general' }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    console.error('Missing Twilio environment variables')
    return { success: false, error: 'Twilio not configured' }
  }

  const toFormatted = formatE164(to)

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: toFormatted,
          From: fromNumber,
          Body: body
        }).toString()
      }
    )

    const result = await response.json()

    // Log to sms_log table
    await supabase.from('sms_log').insert({
      to_number: toFormatted,
      message_body: body,
      event_type: eventType,
      status: response.ok ? 'sent' : 'failed',
      created_at: new Date().toISOString()
    }).then(() => {}).catch(err => console.error('SMS log insert error:', err))

    if (!response.ok) {
      console.error('Twilio API error:', result)
      return { success: false, error: result.message || 'Twilio send failed' }
    }

    return { success: true, sid: result.sid }
  } catch (err) {
    console.error('SMS send error:', err)

    await supabase.from('sms_log').insert({
      to_number: toFormatted,
      message_body: body,
      event_type: eventType,
      status: 'error',
      created_at: new Date().toISOString()
    }).catch(() => {})

    return { success: false, error: err.message }
  }
}

module.exports = { sendSms, formatE164 }
