// automation/shared/errors.js
// Classifies errors and updates the automation run record
const { createClient } = require('@supabase/supabase-js')
const { RUN_STATUS_ERROR } = require('../../lib/automation/run-status.js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function classifyError(err) {
  const msg = err.message.toLowerCase()
  if (msg.includes('captcha') || msg.includes('recaptcha')) return 'captcha_detected'
  if (msg.includes('timeout')) return 'timeout'
  if (msg.includes('locator') || msg.includes('not found') || msg.includes('no element')) return 'selector_not_found'
  if (msg.includes('login') || msg.includes('invalid') || msg.includes('credentials')) return 'login_failed'
  if (msg.includes('missing') || msg.includes('document')) return 'missing_document'
  return 'unknown'
}

async function handleRunError(runId, jobId, err) {
  const supabase = getSupabase()
  const errorCode = classifyError(err)
  await supabase.from('automation_runs')
    .update({
      run_status: RUN_STATUS_ERROR,
      error_code: errorCode,
      error_message: err.message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
  await supabase.from('jobs')
    .update({ job_status: 'needs_correction' })
    .eq('id', jobId)
  console.log(`Run ${runId} failed: ${errorCode} — ${err.message}`)
}

module.exports = { classifyError, handleRunError }