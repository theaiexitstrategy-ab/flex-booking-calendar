// Booking widget services + schedule API.
//
// Returns the active services for The Flex Facility along with each
// service's per-day-of-week availability templates, formatted so the
// widget's index.html can drop the response straight into its SESSIONS
// object instead of using the hardcoded fallback.
//
// Source of truth lives in the goelev8.ai-portal Supabase project
// (project ref bnkoqybkmwtrlorhowyv) — same DB this repo's other
// endpoints already use. Tables:
//   - public.booking_services       (one row per service per client)
//   - public.availability_templates (one row per (service, day, slot))
//   - public.clients                (slug → id lookup)
//
// Schema set up in goelev8.ai-portal migration 0018. The portal manages
// these tables via its Bookings tab; this endpoint is the read side
// powering book.theflexfacility.com.
//
// Response shape:
//   { success: true, services: [
//       { key, name, fullName, btnText, maxPerSlot,
//         infoTitle, infoNote, schedule: { "0": [{startTime, endTime, displayTime}], ... } },
//       ...
//   ]}
//
// On any error, returns { success: false, error: "..." } with HTTP 500.
// The widget's index.html catches this and silently keeps its hardcoded
// SESSIONS object so the booking page never breaks.

var supabaseAdmin = require('../lib/supabaseAdmin')

var FLEX_FACILITY_SLUG = process.env.NEXT_PUBLIC_FLEX_FACILITY_SLUG || 'flex-facility'

// "08:30:00" → "8:30 AM" — match the format the widget already renders.
// The widget's calendar grid + summary line both expect "H:MM AM/PM"
// with no leading zero on the hour.
function formatTime12h(t) {
  if (!t) return ''
  var parts = String(t).split(':')
  var h = parseInt(parts[0], 10)
  var m = parts[1] || '00'
  var period = h >= 12 ? 'PM' : 'AM'
  var h12 = h % 12
  if (h12 === 0) h12 = 12
  return h12 + ':' + m + ' ' + period
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Cache for 60s at the edge — services + schedules don't change often
  // and the widget falls back to hardcoded if this fetch ever fails.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    // 1. Resolve client_id by slug.
    var clientResult = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('slug', FLEX_FACILITY_SLUG)
      .maybeSingle()

    if (clientResult.error) throw clientResult.error
    if (!clientResult.data) {
      return res.status(404).json({ success: false, error: 'client_not_found' })
    }
    var clientId = clientResult.data.id

    // 2. Pull active services in display order.
    var servicesResult = await supabaseAdmin
      .from('booking_services')
      .select('id, key, name, full_name, btn_text, max_per_slot, info_title, info_note, sort_order')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (servicesResult.error) throw servicesResult.error
    var services = servicesResult.data || []
    if (!services.length) {
      // No services configured — let the widget fall back to its hardcoded
      // SESSIONS rather than rendering an empty calendar. 200 + empty
      // array is cleaner than 404 here because the client_id WAS found.
      return res.status(200).json({ success: true, services: [] })
    }

    // 3. Pull all active availability templates for those services in one
    //    round trip, then group by service id in JS.
    var serviceIds = services.map(function (s) { return s.id })
    var templatesResult = await supabaseAdmin
      .from('availability_templates')
      .select('service_id, day_of_week, start_time, end_time')
      .in('service_id', serviceIds)
      .eq('is_active', true)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })

    if (templatesResult.error) throw templatesResult.error
    var templates = templatesResult.data || []

    // Build { service_id: { dayOfWeek: [slot, ...] } }
    var schedulesByService = {}
    for (var i = 0; i < templates.length; i++) {
      var t = templates[i]
      if (!schedulesByService[t.service_id]) schedulesByService[t.service_id] = {}
      var dow = String(t.day_of_week)
      if (!schedulesByService[t.service_id][dow]) schedulesByService[t.service_id][dow] = []
      schedulesByService[t.service_id][dow].push({
        startTime:   t.start_time,
        endTime:     t.end_time,
        displayTime: formatTime12h(t.start_time)
      })
    }

    // 4. Map services into the widget-friendly shape.
    var responseServices = services.map(function (s) {
      return {
        key:         s.key,
        name:        s.name,
        fullName:    s.full_name,
        btnText:     s.btn_text,
        maxPerSlot:  s.max_per_slot,
        infoTitle:   s.info_title,
        infoNote:    s.info_note,
        schedule:    schedulesByService[s.id] || {}
      }
    })

    return res.status(200).json({ success: true, services: responseServices })
  } catch (err) {
    console.error('Services API error:', err)
    return res.status(500).json({ success: false, error: err.message || 'unknown_error' })
  }
}
