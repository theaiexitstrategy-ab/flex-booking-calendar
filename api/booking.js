export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: 'Booking ID required' });

  if (req.method === 'GET') {
    try {
      const r = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings — Master')}/${id}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message);
      return res.status(200).json({ id: data.id, ...data.fields });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  if (req.method === 'PATCH') {
    const { status, date, time, notes } = req.body;
    const fields = {};
    if (status) fields['Status'] = status;
    if (date) fields['Date'] = date;
    if (time) fields['Time'] = time;
    if (notes !== undefined) fields['Notes'] = notes;

    try {
      const r = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings — Master')}/${id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields })
        }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message);
      return res.status(200).json({ id: data.id, ...data.fields });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
