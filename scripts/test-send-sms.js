#!/usr/bin/env node
// Hits the live /api/send-sms endpoint with a test number so we can confirm
// SMS fires before pointing VAPI at it.
//
// Run:
//   TEST_PHONE=+13145551234 node scripts/test-send-sms.js
// or:
//   node --env-file=.env.local scripts/test-send-sms.js

const ENDPOINT =
  process.env.SEND_SMS_URL || 'https://book.theflexfacility.com/api/send-sms'

async function main() {
  const phone = process.env.TEST_PHONE
  if (!phone) {
    console.error('TEST_PHONE env var is required (e.g. TEST_PHONE=+13145551234).')
    process.exit(1)
  }

  console.log(`POST ${ENDPOINT}`)
  console.log(`  phone=${phone}`)

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      caller_name: process.env.TEST_NAME || 'Test Caller',
      source: 'test_script',
    }),
  })

  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }

  console.log(`HTTP ${res.status}`)
  console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2))

  process.exit(res.ok ? 0 : 1)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
