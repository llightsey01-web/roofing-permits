// worker/ops-worker.js
// Worker 3 — notifications, permit packets, status reconcile (no Playwright)

const path = require('path')
// Load local env for dev only — never override Railway-injected vars
require('dotenv').config({ path: path.join(__dirname, '.env.local') })
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

function requireLib(mod) {
  try { return require(path.join(__dirname, mod)) } catch (e) {}
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}
function requireMonitoring(mod) {
  return requireLib(mod)
}
const { validateEnvironment, getEnvironment } = requireLib('lib/env/environment.js')
const { recordWorkerPoll } = requireMonitoring('lib/monitoring/worker-heartbeat')
const { createDailyMetricsScheduler } = requireMonitoring('lib/monitoring/platform-metrics')
const { createProductApprovalsSyncScheduler } = require(path.join(__dirname, '..', 'scripts', 'sync-product-approvals.js'))

validateEnvironment()
console.log('[ops-worker] Environment:', getEnvironment())

const POLL_INTERVAL_MS = 30000
const dailyMetrics = createDailyMetricsScheduler(supabase)
const productApprovalsSync = createProductApprovalsSyncScheduler(supabase)

const HANDLED_RUN_TYPES = [
  'notify_admin',
  'build_packet',
  'status_reconcile',
]

async function markRunComplete(runId, extra) {
  var update = Object.assign({
    run_status: 'complete',
    completed_at: new Date().toISOString(),
  }, extra || {})
  await supabase.from('automation_runs').update(update).eq('id', runId)
}

async function markRunError(runId, err) {
  await supabase.from('automation_logs').insert({
    run_id: runId,
    step_number: 99,
    step_name: 'error',
    success: false,
    notes: err.message,
    raw_error: err.stack || '',
  })
  await supabase.from('automation_runs').update({
    run_status: 'error',
    error_message: err.message,
    completed_at: new Date().toISOString(),
  }).eq('id', runId)
}

async function handleNotifyAdmin(job, run) {
  console.log('[ops-worker] notify_admin placeholder for job ' + job.id)
  await markRunComplete(run.id)
  return { skipped: true, reason: 'notify_admin not implemented' }
}

async function handleBuildPacket(job, run) {
  console.log('[ops-worker] build_packet placeholder for job ' + job.id)
  await markRunComplete(run.id)
  return { skipped: true, reason: 'build_packet not implemented' }
}

async function handleStatusReconcile(job, run) {
  console.log('[ops-worker] status_reconcile placeholder for job ' + job.id)
  await markRunComplete(run.id)
  return { skipped: true, reason: 'status_reconcile not implemented' }
}

async function executeRun(job, run) {
  switch (run.run_type) {
    case 'notify_admin':
      return handleNotifyAdmin(job, run)
    case 'build_packet':
      return handleBuildPacket(job, run)
    case 'status_reconcile':
      return handleStatusReconcile(job, run)
    default:
      throw new Error('Unsupported run_type: ' + run.run_type)
  }
}

async function claimAndRun() {
  console.log('[ops-worker] Polling for queued ops runs...')

  var { data: runs, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_status, run_type, payload, dependency_run_id, attempts')
    .eq('run_status', 'queued')
    .in('run_type', HANDLED_RUN_TYPES)
    .order('started_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[ops-worker] Query error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    console.log('[ops-worker] No queued runs found')
    return
  }

  var run = runs[0]
  console.log('[ops-worker] Found queued run:', run.id, 'type:', run.run_type, 'job:', run.job_id)

  var { error: claimError } = await supabase
    .from('automation_runs')
    .update({ run_status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('run_status', 'queued')

  if (claimError) {
    console.error('[ops-worker] Claim error:', claimError.message)
    return
  }

  var { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', run.job_id).single()

  if (jobError || !job) {
    await markRunError(run.id, new Error('Job not found: ' + run.job_id))
    return
  }

  try {
    var result = await executeRun(job, run)
    console.log('[ops-worker] Run complete:', run.id, run.run_type)
    return result
  } catch (err) {
    console.error('[ops-worker] Run failed:', err.message)
    await markRunError(run.id, err)
  }
}

async function poll() {
  try {
    await recordWorkerPoll('ops')
    try {
      await dailyMetrics.maybeRunDailyMetrics()
    } catch (metricsErr) {
      console.error('[ops-worker] Daily metrics error:', metricsErr.message)
    }
    try {
      var productSyncResult = await productApprovalsSync.maybeSyncProductApprovals()
      if (productSyncResult && !productSyncResult.skipped) {
        console.log('[ops-worker] Product approvals sync finished:', {
          upserted: productSyncResult.upserted,
          pdfOk: productSyncResult.pdfOk,
          uploadOk: productSyncResult.uploadOk,
        })
      }
    } catch (productSyncErr) {
      console.error('[ops-worker] Product approvals sync error:', productSyncErr.message)
    }
    await claimAndRun()
  } catch (err) {
    console.error('[ops-worker] Poll error:', err.message)
  }
  setTimeout(poll, POLL_INTERVAL_MS)
}

console.log('[ops-worker] Starting lightweight ops worker (Worker 3)')
console.log('[ops-worker] Handled run types:', HANDLED_RUN_TYPES.join(', '))
poll()
