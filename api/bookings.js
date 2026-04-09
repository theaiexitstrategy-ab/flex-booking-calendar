var supabaseAdmin = require('../lib/supabaseAdmin')
var smsUtils = require('./utils/sendSms')
var sendSms = smsUtils.sendSms
var formatE164 = smsUtils.formatE164

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    var body = req.body
    var name = body.name || ''
    var phone = body.phone || ''
    var email = body.email || ''
    var session_type = body.session_type || 'athlete'
    var session_name = body.session_name || ''
    var date = body.date || ''
    var time = body.time || ''
    var firstName = name.split(' ')[0] || ''
    var phoneE164 = formatE164(phone)

    // Look up flex-facility client_id
    var clientId = null
    try {
      var clientResult = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('slug', FLEX_FACILITY_SLUG)
        .maybeSingle()
      if (clientResult.data) clientId = clientResult.data.id
      if (!clientId) console.log('No client found for slug:', FLEX_FACILITY_SLUG)
    } catch (ce) {
      console.error('Client lookup error:', ce.message)
    }

    // ── STEP 1: Insert into bookings table ──
    var bookingDate = date + ' ' + time
    var bookingPayload = {
      lead_name: name,
      phone: phoneE164,
      email: email,
      booking_date: bookingDate,
      service_type: session_name || session_type,
      status: 'Confirmed',
      source: 'book.theflexfacility.com',
      created_at: new Date().toISOString()
    }
    // Only include client_id if we found one (avoids NOT NULL constraint errors)
    if (clientId) bookingPayload.client_id = clientId

    var bookingResult = await supabaseAdmin
      .from('bookings')
      .insert(bookingPayload)
      .select()
      .single()

    if (bookingResult.error) {
      console.error('Booking insert error:', JSON.stringify(bookingResult.error))
      throw new Error(bookingResult.error.message || 'Failed to insert booking')
    }

    var bookingRow = bookingResult.data
    var bookingId = bookingRow ? bookingRow.id : ''

    // ── STEP 2: Upsert into leads table ──
    var leadId = null
    try {
      // Check if phone already exists in leads
      var existingLead = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('phone', phoneE164)
        .maybeSingle()

      if (existingLead.data) {
        // Update existing lead status
        leadId = existingLead.data.id
        await supabaseAdmin
          .from('leads')
          .update({
            status: 'Ready to Book',
            name: name,
            email: email
          })
          .eq('id', leadId)
      } else {
        // Insert new lead
        var leadPayload = {
          name: name,
          phone: phoneE164,
          email: email,
          source: 'book.theflexfacility.com',
          funnel: 'booking',
          status: 'Ready to Book',
          tags: ['ready-to-book'],
          created_at: new Date().toISOString()
        }
        if (clientId) leadPayload.client_id = clientId

        var leadResult = await supabaseAdmin
          .from('leads')
          .insert(leadPayload)
          .select('id')
          .single()
        if (leadResult.data) leadId = leadResult.data.id
      }
    } catch (le) {
      console.error('Lead upsert error:', le.message)
    }

    // Update booking with lead_id if available
    if (leadId && bookingId) {
      await supabaseAdmin
        .from('bookings')
        .update({ lead_id: leadId })
        .eq('id', bookingId)
        .then(function() {})
        .catch(function(err) { console.error('Booking lead_id update error:', err) })
    }

    // Mark time slot as unavailable if time_slots table exists
    try {
      await supabaseAdmin
        .from('time_slots')
        .update({
          is_available: false,
          booked_by_lead_id: leadId
        })
        .eq('client_id', clientId)
        .eq('slot_date', date)
        .eq('slot_time', time)
    } catch (slotErr) {
      console.error('Slot update error (non-blocking):', slotErr.message)
    }

    // ── STEP 3: POST to GoElev8 portal webhook ──
    try {
      var webhookSecret = process.env.GOELEV8_WEBHOOK_SECRET
      if (webhookSecret) {
        await fetch('https://portal.goelev8.ai/api/webhooks/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goelev8-secret': webhookSecret
          },
          body: JSON.stringify({
            slug: FLEX_FACILITY_SLUG,
            name: name,
            phone: phoneE164,
            email: email,
            source: 'book.theflexfacility.com',
            funnel: 'booking',
            metadata: {
              booking_date: bookingDate,
              service_type: session_name || session_type
            }
          })
        })
      }
    } catch (whErr) {
      console.error('GoElev8 webhook error (non-blocking):', whErr.message)
    }

    // ── STEP 4 & 5: Send Twilio SMS ──
    var baseUrl = process.env.SITE_URL || 'https://book.theflexfacility.com'
    var manageUrl = baseUrl + '/manage.html?id=' + bookingId

    try {
      await Promise.all([
        // STEP 4: SMS to booker
        sendSms({
          to: phone,
          body: 'Hi ' + firstName + '! Your appointment with The Flex Facility is confirmed for ' + date + ' at ' + time + '. Questions? Call or text 1-877-515-FLEX \uD83D\uDC4A\uD83C\uDFFE\n- Coach Kenny\n\nManage booking: ' + manageUrl + '\n\nReply STOP to opt out.',
          eventType: 'booking'
        }),
        // STEP 5: SMS to Coach Kenny
        sendSms({
          to: process.env.COACH_KENNY_PHONE || '3149102203',
          body: 'New booking! ' + name + ' just booked for ' + date + ' at ' + time + '. View in portal: portal.goelev8.ai',
          eventType: 'booking'
        })
      ])
    } catch (smsErr) {
      console.error('SMS error (non-blocking):', smsErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Booking confirmed — SMS sent',
      data: { booking_id: bookingId, lead_id: leadId }
    })
  } catch (err) {
    console.error('Booking API error:', err.message)
    return res.status(500).json({ success: false, error: err.message })
  }
}
