const supabaseAdmin = require('../lib/supabaseAdmin')
const { deductCredit } = require('../lib/deductCredit')
const { formatE164 } = require('./utils/sendSms')

const CLIENT_ID = 'flex-facility'
const SMS_BODY =
  "Hey! Here's your link to book your free assessment at The Flex Facility: " +
  'https://book.theflexfacility.com — Coach Kenny is looking forward to meeting you 💪🏾'

function isValidE164(phone) {
  return typeof phone === 'string' && /^\+[1-9]\d{6,14}$/.test(phone)
}

function extractVapiCall(body) {
  const toolCall = body && body.message && Array.isArray(body.message.toolCalls)
    ? body.message.toolCalls[0]
    : null
  if (!toolCall) return null
  let args = toolCall.function && toolCall.function.arguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { args = {} }
  }
  return {
    toolCallId: toolCall.id,
    phone: args && args.phone,
    caller_name: args && args.caller_name,
  }
}

function vapiResult(toolCallId, message) {
  return { results: [{ toolCallId, result: message }] }
}

async function sendTwilio({ to, from }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken || !from) {
    throw new Error('twilio_not_configured')
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: SMS_BODY }).toString(),
    }
  )
  const json = await res.json()
  if (!res.ok) {
    const msg = json && (json.message || json.error_message)
    throw new Error(msg || `twilio_status_${res.status}`)
  }
  return json
}

module.exports = async function handler(req, res) {
  let isVapi = false
  let toolCallId = null

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ success: false, error: 'method_not_allowed' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

    const vapi = extractVapiCall(body)
    isVapi = !!vapi
    toolCallId = vapi ? vapi.toolCallId : null

    const rawPhone = vapi ? vapi.phone : body.phone
    const callerName = (vapi ? vapi.caller_name : body.caller_name) || null
    const source = isVapi ? 'vapi' : (body.source || 'vapi')

    if (!rawPhone) {
      const msg = 'phone_required'
      return isVapi
        ? res.status(200).json(vapiResult(toolCallId, "I couldn't send the text — no phone number was provided."))
        : res.status(400).json({ success: false, error: msg })
    }

    const phone = formatE164(rawPhone)
    if (!isValidE164(phone)) {
      const msg = 'invalid_phone'
      return isVapi
        ? res.status(200).json(vapiResult(toolCallId, "I couldn't send the text — the phone number didn't look valid."))
        : res.status(400).json({ success: false, error: msg, phone })
    }

    const credit = await deductCredit(CLIENT_ID)
    if (!credit.ok) {
      if (credit.reason === 'insufficient_credits') {
        return isVapi
          ? res.status(200).json(vapiResult(toolCallId, "I couldn't send the text right now — we're out of SMS credits. The team has been notified."))
          : res.status(402).json({ success: false, error: 'insufficient_credits' })
      }
      return isVapi
        ? res.status(200).json(vapiResult(toolCallId, "Something went wrong sending the text. The team has been notified."))
        : res.status(500).json({ success: false, error: credit.reason || 'credit_error' })
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER

    const [twilioResult, logResult] = await Promise.allSettled([
      sendTwilio({ to: phone, from: fromNumber }),
      supabaseAdmin
        .from('sms_log')
        .insert({
          client_id: CLIENT_ID,
          to_number: phone,
          from_number: fromNumber,
          body: SMS_BODY,
          twilio_sid: null,
          status: 'pending',
          source,
          message_body: SMS_BODY,
          event_type: source,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single(),
    ])

    let logRowId = null
    if (logResult.status === 'fulfilled') {
      if (logResult.value.error) {
        console.error('[send-sms] sms_log insert error:', logResult.value.error)
      } else {
        logRowId = logResult.value.data && logResult.value.data.id
      }
    } else {
      console.error('[send-sms] sms_log insert rejected:', logResult.reason)
    }

    if (twilioResult.status === 'rejected') {
      const errMsg = twilioResult.reason && twilioResult.reason.message
        ? twilioResult.reason.message
        : 'twilio_send_failed'
      console.error('[send-sms] twilio send failed:', errMsg, '— caller:', callerName, 'phone:', phone)
      if (logRowId) {
        try {
          await supabaseAdmin.from('sms_log').update({ status: 'failed' }).eq('id', logRowId)
        } catch (e) {
          console.error('[send-sms] failed-status update error:', e)
        }
      }
      return isVapi
        ? res.status(200).json(vapiResult(toolCallId, "I tried to send the text but it didn't go through. The team has been notified."))
        : res.status(502).json({ success: false, error: errMsg })
    }

    const sid = twilioResult.value && twilioResult.value.sid
    const twilioStatus = (twilioResult.value && twilioResult.value.status) || 'sent'

    if (logRowId) {
      try {
        await supabaseAdmin
          .from('sms_log')
          .update({ twilio_sid: sid, status: twilioStatus })
          .eq('id', logRowId)
      } catch (e) {
        console.error('[send-sms] sid stamp update error:', e)
      }
    }

    if (isVapi) {
      const who = callerName ? callerName : 'them'
      return res.status(200).json(
        vapiResult(toolCallId, `Sent. The booking link is on its way to ${who} now.`)
      )
    }
    return res.status(200).json({
      success: true,
      message_sid: sid,
      remaining_credits: credit.remaining,
    })
  } catch (err) {
    console.error('[send-sms] unhandled error:', err)
    if (isVapi) {
      return res.status(200).json(
        vapiResult(toolCallId, "Something went wrong sending the text. The team has been notified.")
      )
    }
    return res.status(500).json({ success: false, error: err.message || 'internal_error' })
  }
}
