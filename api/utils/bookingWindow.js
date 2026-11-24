// Booking lead-time rules.
//
// Coach Kenny needs prep time, so the calendar refuses same-day bookings:
// the earliest bookable date is tomorrow (America/Chicago). The public
// calendar enforces this in the UI, but the API must enforce it too —
// nothing stops a stale tab or a direct POST from submitting today.
//
// All comparisons happen on ISO date strings (YYYY-MM-DD) in the gym's
// timezone. Vercel functions run in UTC, so `new Date()` on the server
// rolls over to "tomorrow" at 7pm Central — reading the date through
// Intl in America/Chicago avoids that off-by-one.

var CAL_TZ = 'America/Chicago'

// Days that must pass before a date is bookable. 1 = no same-day booking.
var MIN_LEAD_DAYS = 1

var MONTHS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
}

// Today's calendar date in the gym's timezone, as YYYY-MM-DD.
function todayIso(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || CAL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

// Earliest date a customer is allowed to book, as YYYY-MM-DD.
function minBookableIso() {
  var parts = todayIso().split('-')
  var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]))
  d.setUTCDate(d.getUTCDate() + MIN_LEAD_DAYS)
  return d.toISOString().slice(0, 10)
}

// Normalize the calendar's display date ("MAY 23, 2026" / "May 23 2026")
// or an already-ISO date to YYYY-MM-DD. Returns null if unparseable.
function toIsoDate(input) {
  var s = String(input || '').trim()
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  var m = s.toUpperCase().match(/([A-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/)
  if (!m) return null
  var month = MONTHS[m[1].slice(0, 3)]
  if (!month) return null
  return m[3] + '-' + String(month).padStart(2, '0') + '-' + String(parseInt(m[2], 10)).padStart(2, '0')
}

// True when the requested date is today or earlier in Central time.
// Unparseable dates are allowed through — the caller's own validation
// owns that case, and we don't want a format we didn't anticipate to
// silently kill real bookings.
function isTooSoon(input) {
  var requested = toIsoDate(input)
  if (!requested) return false
  return requested < minBookableIso()
}

var TOO_SOON_MESSAGE = MIN_LEAD_DAYS === 1
  ? 'Same-day booking is not available. Please choose a date starting tomorrow.'
  : 'That date is too soon. Please choose a date at least ' + MIN_LEAD_DAYS + ' days out.'

module.exports = {
  CAL_TZ: CAL_TZ,
  MIN_LEAD_DAYS: MIN_LEAD_DAYS,
  todayIso: todayIso,
  minBookableIso: minBookableIso,
  toIsoDate: toIsoDate,
  isTooSoon: isTooSoon,
  TOO_SOON_MESSAGE: TOO_SOON_MESSAGE
}
