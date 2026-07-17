// worker/index.js
const path = require('path')
// Load local env for dev only — never override Railway-injected vars (override: false default)
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

function requireHandler(name) {
  // Docker: /app/handlers/<name>  |  Local: worker/handlers/<name>
  return require(path.join(__dirname, 'handlers', name))
}
function requireMonitoring(mod) {
  return requireLib(mod)
}
const { validateEnvironment, getEnvironment } = requireLib('lib/env/environment.js')
const { sendAlert } = requireMonitoring('lib/monitoring/alert-service')
const { recordWorkerPoll } = requireMonitoring('lib/monitoring/worker-heartbeat')

validateEnvironment()
console.log('[worker] Environment:', getEnvironment())

const POLL_INTERVAL_MS = 30000
const PROOF_POLL_INTERVAL_MS = 30 * 60 * 1000
const PROOF_POLL_START_DELAY_MS = 5 * 60 * 1000

const PERMIT_RUN_TYPES = ['permit_phase_1', 'permit_resume', 'permit_submit']
const PERMIT_RUN_TYPE_FILTER = 'run_type.in.(permit_phase_1,permit_resume,permit_submit),run_type.is.null'
const PERMIT_STUCK_RUN_FILTER = 'run_type.in.(permit_phase_1,permit_resume,permit_submit),run_type.is.null'

async function recoverStuckRuns() {
  console.log('[worker] Checking for stuck running permit runs...')
  const { data: stuckRuns, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_type')
    .eq('run_status', 'running')
    .or(PERMIT_STUCK_RUN_FILTER)

  if (error) {
    console.error('[worker] Failed to check stuck runs:', error.message)
    return
  }

  if (!stuckRuns || stuckRuns.length === 0) {
    console.log('[worker] No stuck runs found')
    return
  }

  console.log('[worker] Found ' + stuckRuns.length + ' stuck run(s) — resetting to queued')

  for (const run of stuckRuns) {
    await supabase
      .from('automation_runs')
      .update({
        run_status: 'queued',
        started_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .eq('run_status', 'running')
    console.log('[worker] Reset stuck run:', run.id, 'type:', run.run_type || '(null)')
  }
}

async function claimAndRun() {
  console.log('[worker] Polling for queued permit portal runs...')

  const { data: runs, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_status, run_type, payload, dependency_run_id, attempts')
    .eq('run_status', 'queued')
    .or(PERMIT_RUN_TYPE_FILTER)
    .order('started_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[worker] Query error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    console.log('[worker] No queued permit runs found')
    return
  }

  const run = runs[0]
  console.log('[worker] Found queued run:', run.id, 'job:', run.job_id, 'run_type:', run.run_type || '(null)')

  const { error: claimError } = await supabase
    .from('automation_runs')
    .update({
      run_status: 'running',
      started_at: new Date().toISOString(),
      attempts: (run.attempts || 0) + 1,
    })
    .eq('id', run.id)
    .eq('run_status', 'queued')

  if (claimError) {
    console.error('[worker] Claim error:', claimError.message)
    return
  }

  console.log('[worker] Claimed run:', run.id)

  const { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', run.job_id).single()

  if (jobError || !job) {
    console.error('[worker] Job not found:', run.job_id)
    return
  }

  const { data: documents } = await supabase
    .from('job_documents').select('*').eq('job_id', run.job_id)

  const jobWithDocs = { ...job, documents: documents || [] }

  try {
    const { executeRun } = require('./runner')
    const { handlePolkPermit } = require('./handlers/polk-handler.js')
    await handlePolkPermit(jobWithDocs, run, {
      runPermitWorkflow: function (j, runId) {
        return executeRun(j, Object.assign({}, run, { id: runId }))
      },
      serviceKey: 'polk',
    })
  } catch (permitErr) {
    console.error('[worker] Permit run failed:', permitErr.message)
    await supabase.from('automation_runs').update({
      run_status: 'error',
      error_message: permitErr.message,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id)
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', job.id)
  }

  var { data: finishedRun } = await supabase
    .from('automation_runs')
    .select('run_status, attempts, error_message, run_type')
    .eq('id', run.id)
    .single()

  if (
    finishedRun &&
    finishedRun.run_status === 'error' &&
    (finishedRun.attempts || 0) >= 3
  ) {
    await sendAlert({
      type: 'automation_failed',
      severity: 'critical',
      jobId: job.id,
      companyId: job.company_id,
      message: 'Permit automation failed after ' + finishedRun.attempts + ' attempts',
      details: {
        runId: run.id,
        runType: finishedRun.run_type,
        stepName: finishedRun.run_type,
        errorMessage: finishedRun.error_message,
        propertyAddress: [job.property_address, job.property_city, job.property_state].filter(Boolean).join(', '),
        worker: 'permit',
      },
    })
  }
}

async function poll() {
  try {
    await recordWorkerPoll('permit')
    await claimAndRun()
  } catch (err) {
    console.error('[worker] Poll error:', err.message)
  }
  setTimeout(poll, POLL_INTERVAL_MS)
}

async function pollProofCompletions() {
  try {
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, owner_name, property_address, job_specs, noc_status')
      .eq('noc_status', 'sent_to_homeowner')

    if (error) {
      console.error('[proof-poller] Query error:', error.message)
      return
    }

    if (!jobs || jobs.length === 0) {
      console.log('[proof-poller] No jobs waiting for Proof completion')
      return
    }

    console.log('[proof-poller] Checking ' + jobs.length + ' job(s) for Proof completion...')

    const { runProofCompletionCheck } = require('../lib/proof/completion.js')

    for (const job of jobs) {
      try {
        console.log('[proof-poller] Checking job ' + job.id + ' (' + job.property_address + ')...')

        const result = await runProofCompletionCheck({ jobId: job.id, headless: true })
        const jobResult = (result.results || [])[0]

        if (jobResult && jobResult.complete) {
          console.log('[proof-poller] ✓ Job ' + job.id + ' notarized — triggering ePN')
          await supabase.from('jobs')
            .update({ noc_status: 'queued_for_erecord' })
            .eq('id', job.id)
        } else {
          console.log('[proof-poller] Job ' + job.id + ' not yet complete')
        }
      } catch (jobErr) {
        console.error('[proof-poller] Error checking job ' + job.id + ':', jobErr.message)
      }
    }
  } catch (err) {
    console.error('[proof-poller] Poll error:', err.message)
  }

  setTimeout(pollProofCompletions, PROOF_POLL_INTERVAL_MS)
}

console.log('[worker] Starting AHJ-iQ permit portal worker (Worker 1)')
console.log('[worker] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING')
console.log('[worker] Service key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
recoverStuckRuns().then(function() {
  poll()
  setTimeout(pollProofCompletions, PROOF_POLL_START_DELAY_MS)
})
