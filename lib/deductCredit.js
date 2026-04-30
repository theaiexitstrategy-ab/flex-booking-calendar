const supabaseAdmin = require('./supabaseAdmin')

async function deductCredit(clientId) {
  if (!clientId) return { ok: false, reason: 'missing_client_id' }

  const { data, error } = await supabaseAdmin.rpc('deduct_sms_credit', {
    p_client_id: clientId,
  })

  if (error) {
    console.error('[deductCredit] supabase error:', error)
    return { ok: false, reason: 'db_error', error: error.message }
  }
  if (data === null || typeof data === 'undefined') {
    return { ok: false, reason: 'insufficient_credits' }
  }
  return { ok: true, remaining: data }
}

module.exports = { deductCredit }
