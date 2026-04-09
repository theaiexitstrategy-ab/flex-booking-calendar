import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type NudgeFn = (name: string) => string

const nudge1: NudgeFn = (name) =>
  `Hey ${name}! 👋🏾 Still thinking about leveling up your performance? Coach Kenny has open slots this week. Book your free assessment: book.theflexfacility.com`

const nudge2: NudgeFn = (_name) =>
  `What's stopping you? 💪🏾 Your free Athlete Performance Assessment at The Flex Facility takes less than an hour and could change everything. book.theflexfacility.com`

const nudge3: NudgeFn = (name) =>
  `Hey ${name} — Coach Kenny wanted me to check in. Spots are limited this week. Lock yours in: book.theflexfacility.com 🔒`

const NUDGE_MESSAGES: NudgeFn[] = [nudge1, nudge2, nudge3]

function formatE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

async function sendSms(
  to: string,
  body: string,
  accountSid: string,
  authToken: string,
  fromNumber: string,
): Promise<{ success: boolean; sid?: string; error?: string }> {
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: formatE164(to),
          From: fromNumber,
          Body: body,
        }).toString(),
      },
    )

    const result = await response.json()

    if (!response.ok) {
      console.error('Twilio error:', result)
      return { success: false, error: result.message }
    }

    return { success: true, sid: result.sid }
  } catch (err) {
    console.error('SMS send error:', err)
    return { success: false, error: (err as Error).message }
  }
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const twilioFrom = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER')!

  const supabase = createClient(supabaseUrl, supabaseKey)

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  // Query leads table (migrated from contacts_master)
  const { data: leads, error: queryErr } = await supabase
    .from('leads')
    .select('id, name, phone, nudge_count, last_nudge_sent')
    .not('phone', 'is', null)
    .eq('opted_out', false)
    .lt('nudge_count', 5)
    .is('booked_at', null)
    .or(`last_nudge_sent.is.null,last_nudge_sent.lt.${threeDaysAgo}`)

  if (queryErr) {
    console.error('Query error:', queryErr)
    return new Response(JSON.stringify({ error: queryErr.message }), { status: 500 })
  }

  if (!leads || leads.length === 0) {
    return new Response(JSON.stringify({ message: 'No leads to nudge', sent: 0 }))
  }

  let sentCount = 0
  const errors: string[] = []

  for (const lead of leads) {
    const firstName = (lead.name || '').split(' ')[0]
    const nudgeIndex = (lead.nudge_count || 0) % 3
    const message = NUDGE_MESSAGES[nudgeIndex](firstName)

    const result = await sendSms(lead.phone, message, twilioSid, twilioToken, twilioFrom)

    await supabase.from('sms_log').insert({
      to_number: formatE164(lead.phone),
      message_body: message,
      event_type: 'nudge',
      status: result.success ? 'sent' : 'failed',
      created_at: new Date().toISOString(),
    })

    if (result.success) {
      await supabase
        .from('leads')
        .update({
          nudge_count: (lead.nudge_count || 0) + 1,
          last_nudge_sent: new Date().toISOString(),
        })
        .eq('id', lead.id)

      sentCount++
    } else {
      errors.push(`Failed for ${lead.name}: ${result.error}`)
    }
  }

  console.log(`Nudge complete: ${sentCount}/${leads.length} sent`)

  return new Response(
    JSON.stringify({
      message: 'Nudge sequence complete',
      total: leads.length,
      sent: sentCount,
      errors: errors.length > 0 ? errors : undefined,
    }),
  )
})
