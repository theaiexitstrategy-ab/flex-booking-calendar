// Supabase Edge Function: booking-reminders
// Schedule via pg_cron to run every 30 minutes
// Calls the /api/reminders endpoint on the Vercel-deployed site

Deno.serve(async () => {
  const siteUrl = Deno.env.get('SITE_URL') || 'https://book.theflexfacility.com'
  const cronSecret = Deno.env.get('CRON_SECRET') || ''

  try {
    const response = await fetch(siteUrl + '/api/reminders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
    })

    const result = await response.json()
    console.log('Reminder check result:', JSON.stringify(result))

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Reminder edge function error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
