export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, message, booking_id } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to and message required' });

  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_FROM_NUMBER;

  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ To: to, From: FROM, Body: message })
      }
    );

    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Twilio error');

    // log to Airtable SMS Log if booking_id provided
    if (booking_id && process.env.AIRTABLE_API_KEY) {
      fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent('SMS Log')}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              'Recipient Phone': to,
              'Message': message,
              'Sent At': new Date().toISOString(),
              'Sent By': 'Portal',
              'Status': 'Sent',
              'Twilio SID': data.sid
            }
          })
        }
      ).catch(() => {});
    }

    return res.status(200).json({ success: true, sid: data.sid });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
