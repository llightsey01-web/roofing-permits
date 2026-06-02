// worker/noc-proof-erecord-worker.js
// Worker 2 — NOC generation, Proof.com, ePN recording (Playwright)

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const POLL_INTERVAL_MS = 30000

const HANDLED_RUN_TYPES = [
  'noc_generate',
  'proof_send',
  'proof_check',
  'erecord_prepare',
  'erecord_submit',
]

function resolveLib(relativePath) {
  var candidates = [
    path.join(__dirname, relativePath),
    path.join(__dirname, '..', relativePath),
  ]
  for (var i = 0; i < candidates.length; i++) {
    try { return require(candidates[i]) } catch (e) {}
  }
  throw new Error('Cannot resolve lib module: ' + relativePath)
}

async function markRunComplete(runId, extra) {
  var update = Object.assign({
    run_status: 'complete',
    completed_at: new Date().toISOString(),
  }, extra || {})
  await supabase.from('automation_runs').update(update).eq('id', runId)
}

async function markRunError(runId, jobId, err) {
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
  if (jobId) {
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', jobId)
  }
}

async function requeueRun(runId, attempts) {
  await supabase.from('automation_runs').update({
    run_status: 'queued',
    attempts: (attempts || 0) + 1,
    started_at: new Date().toISOString(),
  }).eq('id', runId)
}

async function handleNocGenerate(job, run) {
  var { runNocPhaseForJob } = resolveLib('lib/noc/run-noc-phase.js')
  var chain = resolveLib('lib/automation/noc-proof-erecord-chain.js')

  var phase = await runNocPhaseForJob(job.id, { currentRunId: run.id })
  await markRunComplete(run.id)

  var queued = await chain.queueDownstreamAfterNoc(job.id, run.id, {})
  return { phase: phase, queued: queued }
}

async function handleProofSend(job, run) {
  var { sendNocToProof } = resolveLib('lib/proof/send-noc-to-proof.js')
  var chain = resolveLib('lib/automation/noc-proof-erecord-chain.js')

  var result = await sendNocToProof(job.id, { headless: true, companyId: job.company_id || null })
  await markRunComplete(run.id)

  var queued = await chain.queueProofCheckRun(job.id, run.id, {})
  return { result: result, queued: queued }
}

async function handleProofCheck(job, run) {
  var { runProofCompletionCheck } = resolveLib('lib/proof/completion.js')
  var chain = resolveLib('lib/automation/noc-proof-erecord-chain.js')

  var checkResult = await runProofCompletionCheck({
    jobId: job.id,
    headless: true,
    companyId: job.company_id || null,
  })
  var jobResult = (checkResult.results || [])[0]

  if (jobResult && jobResult.complete) {
    await markRunComplete(run.id)
    var queued = await chain.queueErecordPrepareRun(job.id, run.id, {})
    return { complete: true, jobResult: jobResult, queued: queued }
  }

  console.log('[noc-worker] Proof not complete for job ' + job.id + ' — requeue proof_check')
  await requeueRun(run.id, run.attempts)
  return { complete: false, requeued: true }
}

async function handleErecordPrepare(job, run) {
  var { prepareRecordingPackage } = resolveLib('lib/erecord/service.js')

  var prepResult = await prepareRecordingPackage(job.id, {
    headless: true,
    companyId: job.company_id || null,
  })
  await markRunComplete(run.id)
  return prepResult
}

async function handleErecordSubmit(job, run) {
  console.log('[noc-worker] erecord_submit placeholder for run ' + run.id)
  await markRunComplete(run.id, { run_status: 'needs_review' })
  return { skipped: true, reason: 'erecord_submit not implemented' }
}

async function executeRun(job, run) {
  var runType = run.run_type

  switch (runType) {
    case 'noc_generate':
      return handleNocGenerate(job, run)
    case 'proof_send':
      return handleProofSend(job, run)
    case 'proof_check':
      return handleProofCheck(job, run)
    case 'erecord_prepare':
      return handleErecordPrepare(job, run)
    case 'erecord_submit':
      return handleErecordSubmit(job, run)
    default:
      throw new Error('Unsupported run_type: ' + runType)
  }
}

async function claimAndRun() {
  console.log('[noc-worker] Polling for queued NOC/Proof/ePN runs...')

  var { data: runs, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_status, run_type, payload, dependency_run_id, attempts')
    .eq('run_status', 'queued')
    .in('run_type', HANDLED_RUN_TYPES)
    .order('started_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[noc-worker] Query error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    console.log('[noc-worker] No queued runs found')
    return
  }

  var run = runs[0]
  console.log('[noc-worker] Found queued run:', run.id, 'type:', run.run_type, 'job:', run.job_id)

  var { error: claimError } = await supabase
    .from('automation_runs')
    .update({ run_status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('run_status', 'queued')

  if (claimError) {
    console.error('[noc-worker] Claim error:', claimError.message)
    return
  }

  var { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', run.job_id).single()

  if (jobError || !job) {
    console.error('[noc-worker] Job not found:', run.job_id)
    await markRunError(run.id, run.job_id, new Error('Job not found: ' + run.job_id))
    return
  }

  try {
    var result = await executeRun(job, run)
    console.log('[noc-worker] Run complete:', run.id, run.run_type)
    return result
  } catch (err) {
    console.error('[noc-worker] Run failed:', err.message)
    await markRunError(run.id, job.id, err)
  }
}

async function poll() {
  try {
    await claimAndRun()
  } catch (err) {
    console.error('[noc-worker] Poll error:', err.message)
  }
  setTimeout(poll, POLL_INTERVAL_MS)
}

console.log('[noc-worker] Starting NOC + Proof + ePN worker (Worker 2)')
console.log('[noc-worker] Handled run types:', HANDLED_RUN_TYPES.join(', '))
poll()
