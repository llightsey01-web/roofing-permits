// worker/runner.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')
const { getProjectRoot, resolveFromRoot } = require('./project-root')
const { verifyPolkRunnerUsesDirectTrigger } = require('./verify-noc-trigger')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

var verifiedPaths = verifyPolkRunnerUsesDirectTrigger()
console.log('[worker] Project root:', getProjectRoot())
console.log('[worker] Polk runner:', verifiedPaths.polkPath)
console.log('[worker] NOC trigger module:', verifiedPaths.nocTriggerPath)

function loadPolkRunner() {
  var polkRunnerPath = resolveFromRoot('automation/ahjs/polk-county.runner.js')
  return require(polkRunnerPath)
}

async function executeRun(job, runId) {
  try {
    console.log('[worker] Executing run:', runId, 'job:', job.property_address)
    const { runPolkCounty } = loadPolkRunner()
    await runPolkCounty(job, runId)
    console.log('[worker] Run complete:', runId)
  } catch (err) {
    console.error('[worker] Run failed:', err.message)
    await supabase.from('automation_logs').insert({ run_id: runId, step_number: 99, step_name: 'error', success: false, notes: err.message, raw_error: err.stack || '' })
    await supabase.from('automation_runs').update({ run_status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).eq('id', runId)
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', job.id)
  }
}

module.exports = { executeRun, loadPolkRunner, verifyPolkRunnerUsesDirectTrigger }
