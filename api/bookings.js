export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    session_type, session_name, date, time,
    name, phone, email, age, sport, goal,
    guardian, instagram, source
  } = req.body;

  if (!name || !phone || !email || !date || !time || !session_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  try {
    // double-check slot is still available before creating
    const checkUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings — Master')}?filterByFormula=${encodeURIComponent(`AND({Date}="${date}",{Time}="${time}",{Session Type}="${session_type}",{Status}!="Cancelled")`)}`;
    const checkRes = await fetch(checkUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const checkData = await checkRes.json();
    if ((checkData.records || []).length >= 1) {
      return res.status(409).json({ error: 'This slot was just booked. Please choose another time.' });
    }

    // determine segment
    const segment = (Number(age) < 18 || sport) ? 'Athlete' : 'Lifestyle';

    // create booking record in Airtable
    const createRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings — Master')}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Name': name,
            'Phone': phone,
            'Email': email,
            'Session Type': session_name || session_type,
            'Segment': segment,
            'Date': date,
            'Time': time,
            'Status': 'Confirmed',
            'Booking Source': 'book.theflexfacility.com',
            'Booking Source URL': 'https://book.theflexfacility.com',
            'Notes': [sport && `Sport: ${sport}`, goal && `Goal: ${goal}`, guardian && `Guardian: ${guardian}`, instagram && `Instagram: ${instagram}`].filter(Boolean).join(' | '),
            'Created At': new Date().toISOString()
          }
        })
      }
    );

    const created = await createRes.json();
    if (!createRes.ok) throw new Error(created.error?.message || 'Airtable create failed');

    // also update Contacts — Master (upsert by phone)
    const contactSearchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Contacts — Master')}?filterByFormula=${encodeURIComponent(`{Phone}="${phone}"`)}`;
    const contactSearch = await fetch(contactSearchUrl, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    const contactData = await contactSearch.json();

    if (contactData.records?.length > 0) {
      // update existing contact
      const contactId = contactData.records[0].id;
      const existing = contactData.records[0].fields;
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Contacts — Master')}/${contactId}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              'Lead Status': 'Assessment Booked',
              'Total Bookings': (existing['Total Bookings'] || 0) + 1,
              'Last Booking Date': date
            }
          })
        }
      );
    } else {
      // create new contact
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Contacts — Master')}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              'Name': name,
              'Phone': phone,
              'Email': email,
              'Sport': sport || '',
              'Goal': goal || '',
              'Instagram Handle': instagram || '',
              'Lead Status': 'Assessment Booked',
              'Total Bookings': 1,
              'First Contact Date': new Date().toISOString().split('T')[0],
              'Last Booking Date': date,
              'Source': 'Booking Form'
            }
          })
        }
      );
    }

    // fire Make.com webhook as backup notification (don't await — don't block)
    fetch('https://hook.us2.make.com/mkvrxsygnt9962r3odkpigk4k2qiienq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_type, session_name, date, time, name, phone, email, age, sport, goal, guardian, instagram, source: 'booking-calendar', timestamp: new Date().toISOString() })
    }).catch(() => {});

    // send confirmation SMS via Twilio
    try {
      const msg = `Hi ${name.split(' ')[0]}! Your ${session_name || 'assessment'} at The Flex Facility is confirmed for ${date} at ${time}. Questions? Call/text 1-877-515-FLEX. See you soon!`;
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM_NUMBER, Body: msg })
      });
    } catch (smsErr) {
      console.error('Confirmation SMS failed:', smsErr);
      // don't fail the booking if SMS fails
    }

    return res.status(200).json({ success: true, bookingId: created.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
