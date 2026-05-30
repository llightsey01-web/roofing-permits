// worker/runner.js
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)
async function executeRun(job, runId) {
  try {
    console.log('[worker] Executing run:', runId, 'job:', job.property_address)
    const { runPolkCounty } = require('./automation/ahjs/polk-county.runner')
    await runPolkCounty(job, runId)
    console.log('[worker] Run complete:', runId)
  } catch (err) {
    console.error('[worker] Run failed:', err.message)
    await supabase.from('automation_logs').insert({ run_id: runId, step_number: 99, step_name: 'error', success: false, notes: err.message, raw_error: err.stack || '' })
    await supabase.from('automation_runs').update({ run_status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).eq('id', runId)
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', job.id)
  }
}
module.exports = { executeRun }
