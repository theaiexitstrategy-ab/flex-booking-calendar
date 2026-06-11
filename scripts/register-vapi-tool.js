#!/usr/bin/env node
// Registers the `send_booking_link` function tool on the FLEX VAPI assistant.
// Run locally:
//   node --env-file=.env.local scripts/register-vapi-tool.js
// or set VAPI_API_KEY and VAPI_ASSISTANT_ID in your shell first.

const VAPI_BASE = 'https://api.vapi.ai'
const SERVER_URL = 'https://book.theflexfacility.com/api/send-sms'
const TOOL_NAME = 'send_booking_link'

async function main() {
  const apiKey = process.env.VAPI_API_KEY
  const assistantId = process.env.VAPI_ASSISTANT_ID
  if (!apiKey || !assistantId) {
    console.error('Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in environment.')
    process.exit(1)
  }

  // Fetch the current assistant so we can merge tools instead of clobbering.
  const getRes = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!getRes.ok) {
    console.error('Failed to fetch assistant:', getRes.status, await getRes.text())
    process.exit(1)
  }
  const assistant = await getRes.json()
  const existingTools = (assistant.model && Array.isArray(assistant.model.tools))
    ? assistant.model.tools
    : []

  const newTool = {
    type: 'function',
    async: false,
    function: {
      name: TOOL_NAME,
      description:
        'Send the booking link via SMS to a caller who has explicitly confirmed they want it texted to them. ' +
        'Call this immediately after the caller says yes to receiving the text. ' +
        'Do not call this tool unless the caller has clearly said yes, sure, send it, text me, or similar affirmative.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Caller phone number in E.164 format (e.g. +13145551234).',
          },
          caller_name: {
            type: 'string',
            description: 'Optional caller first name to personalize confirmation.',
          },
        },
        required: ['phone'],
      },
    },
    server: { url: SERVER_URL },
  }

  // Replace any prior registration with the same name; keep the rest.
  const mergedTools = existingTools
    .filter((t) => !(t && t.function && t.function.name === TOOL_NAME))
    .concat([newTool])

  const patchRes = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: { ...(assistant.model || {}), tools: mergedTools },
    }),
  })
  const patchJson = await patchRes.json().catch(() => null)
  if (!patchRes.ok) {
    console.error('PATCH failed:', patchRes.status)
    console.error(JSON.stringify(patchJson, null, 2))
    process.exit(1)
  }

  console.log(`Registered tool "${TOOL_NAME}" on assistant ${assistantId}.`)
  console.log('Assistant config response:')
  console.log(JSON.stringify(patchJson, null, 2))
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
