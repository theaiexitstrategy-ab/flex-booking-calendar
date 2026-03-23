const MAX_PER_SLOT = {
  'athlete': 1,
  'lifestyle': 1,
  'bodybuilding': 1
};

const BASE_SCHEDULE = {
  'athlete': {
    0: ['8:30 AM'],
    1: ['7:00 PM'],
    2: ['7:00 PM'],
    3: ['7:00 PM'],
    5: ['9:00 AM', '11:00 AM', '1:00 PM'],
    6: ['9:00 AM', '11:00 AM']
  },
  'lifestyle': {
    1: ['6:00 PM'],
    3: ['6:00 PM'],
    5: ['10:00 AM', '12:00 PM'],
    6: ['10:00 AM']
  },
  'bodybuilding': {
    2: ['6:00 PM'],
    4: ['6:00 PM'],
    5: ['2:00 PM'],
    6: ['12:00 PM']
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { month, year, session_type } = req.query;
  if (!month || !year || !session_type) {
    return res.status(400).json({ error: 'month, year, session_type required' });
  }

  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  try {
    // fetch all confirmed bookings for this month/year/session_type from Airtable
    const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const endDate = `${year}-${String(month).padStart(2,'0')}-31`;

    const filterFormula = encodeURIComponent(
      `AND({Session Type} = "${session_type}", IS_AFTER({Date}, "${startDate}"), IS_BEFORE({Date}, "${endDate}"), {Status} != "Cancelled")`
    );

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Bookings — Master')}?filterByFormula=${filterFormula}&fields[]=Date&fields[]=Time&fields[]=Status&fields[]=Session Type`;

    const airtableRes = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });

    const data = await airtableRes.json();
    const bookings = (data.records || []).map(r => r.fields);

    // build availability map: { "2026-03-25": { "7:00 PM": { booked: 2, max: 1, full: true } } }
    const availability = {};
    const schedule = BASE_SCHEDULE[session_type] || {};

    // initialize all slots for the month
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dow = date.getDay();
      const slots = schedule[dow];
      if (!slots || slots.length === 0) continue;
      const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      availability[dateKey] = {};
      slots.forEach(time => {
        availability[dateKey][time] = { booked: 0, max: MAX_PER_SLOT[session_type] || 1, full: false };
      });
    }

    // count real bookings against slots
    bookings.forEach(b => {
      const dateKey = b['Date'];
      const time = b['Time'];
      if (availability[dateKey] && availability[dateKey][time] !== undefined) {
        availability[dateKey][time].booked++;
        const slot = availability[dateKey][time];
        slot.full = slot.booked >= slot.max;
      }
    });

    // also fetch blocked dates from Availability — Master table
    const blockedUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent('Availability — Master')}?filterByFormula=NOT({Blocked Date} = "")`;
    const blockedRes = await fetch(blockedUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const blockedData = await blockedRes.json();
    const blockedDates = (blockedData.records || []).map(r => r.fields['Blocked Date']).filter(Boolean);

    return res.status(200).json({
      availability,
      blockedDates,
      schedule: BASE_SCHEDULE[session_type] || {}
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
