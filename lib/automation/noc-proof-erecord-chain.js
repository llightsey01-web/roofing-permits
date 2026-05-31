// lib/automation/noc-proof-erecord-chain.js
// Chained automation: Phase 1 → NOC → Proof → completion → eRecord prep

const { createClient } = require('@supabase/supabase-js')
const {
  sendNocToProof,
  evaluateProofSendGate,
} = require('../proof/send-noc-to-proof')
const { runProofCompletionCheck, getProofTransactionId } = require('../proof/completion')
const { queueErecordForJob, prepareRecordingPackage } = require('../erecord/service')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

async function reloadJob(jobId) {
  var supabase = getSupabase()
  var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) throw new Error('Job not found: ' + jobId)
  return job
}

function isPhase1Complete(job) {
  return !!(
    job.parcel_number && String(job.parcel_number).trim() &&
    job.legal_description && String(job.legal_description).trim() &&
    job.portal_confirmation && String(job.portal_confirmation).trim()
  )
}

function hasGeneratedNoc(job) {
  return !!(job.noc_file_path && String(job.noc_file_path).trim())
}

function isProofInFlight(job) {
  return job.noc_status === 'sent_to_homeowner' ||
    !!(job.job_specs && job.job_specs.proof && job.job_specs.proof.transaction_id)
}

function hasNotarizedPdf(job) {
  return !!(job.job_specs && job.job_specs.proof && job.job_specs.proof.notarized_file_path)
}

function isReadyForErecordReview(job) {
  return job.noc_status === 'ready_for_erecord_review'
}

async function startNocPhaseForJob(jobId, options) {
  var mod = await import('../noc/start-noc.js')
  return mod.startNocPhaseForJob(jobId, options)
}

async function continueToErecordPrep(jobId, options) {
  var opts = options || {}
  var job = await reloadJob(jobId)

  if (!hasNotarizedPdf(job)) {
    return { success: false, skipped: true, reason: 'notarized_file_path missing' }
  }

  if (isReadyForErecordReview(job)) {
    return {
      success: true,
      skipped: true,
      reason: 'already ready_for_erecord_review',
      packId: job.job_specs?.erecord?.package_id || null,
      nocStatus: job.noc_status,
    }
  }

  if (job.noc_status !== 'queued_for_erecord') {
    await queueErecordForJob(jobId, { provider: 'epn' })
  }

  var prepResult = await prepareRecordingPackage(jobId, opts)
  return Object.assign({ success: true, skipped: false }, prepResult)
}

async function waitForProofCompletionAndContinue(jobId, options) {
  var opts = options || {}
  var maxWaitMs = opts.maxWaitMs || parseInt(process.env.PROOF_COMPLETION_MAX_WAIT_MS || '1800000', 10)
  var pollMs = opts.pollIntervalMs || parseInt(process.env.PROOF_COMPLETION_POLL_MS || '60000', 10)
  var deadline = Date.now() + maxWaitMs
  var attempts = 0
  var lastResult = null

  console.log('Waiting for Proof notarization (max ' + Math.round(maxWaitMs / 60000) + ' min, poll every ' + Math.round(pollMs / 1000) + 's)...')

  while (Date.now() < deadline) {
    attempts++
    var checkResult = await runProofCompletionCheck({
      jobId: jobId,
      headless: opts.headless !== undefined ? opts.headless : true,
      slowMo: opts.slowMo,
      outputDir: opts.outputDir ? require('path').join(opts.outputDir, 'proof-completion-' + attempts) : undefined,
    })

    if (checkResult.skipped) {
      return {
        complete: false,
        skipped: true,
        reason: checkResult.reason,
        stoppingPoint: 'proof_completion_skipped',
        attempts: attempts,
      }
    }

    var jobResult = (checkResult.results || [])[0] || null
    lastResult = jobResult

    if (jobResult && jobResult.complete) {
      return {
        complete: true,
        attempts: attempts,
        jobResult: jobResult,
        erecordPrepResult: jobResult.erecordPrepResult || null,
        erecordPrepError: jobResult.erecordPrepError || null,
        stoppingPoint: jobResult.erecordPrepResult
          ? 'ready_for_erecord_review'
          : (jobResult.erecordPrepError ? 'erecord_prepare_failed' : 'queued_for_erecord'),
        nocStatus: jobResult.nocStatus,
        notarizedFilePath: jobResult.notarizedFilePath,
      }
    }

    if (jobResult && jobResult.skipped) {
      return {
        complete: false,
        skipped: true,
        reason: jobResult.reason,
        stoppingPoint: 'proof_completion_skipped',
        attempts: attempts,
      }
    }

    var remaining = deadline - Date.now()
    if (remaining <= 0) break

    console.log('Proof not complete yet (attempt ' + attempts + ') — next poll in ' + Math.round(pollMs / 1000) + 's')
    await sleep(Math.min(pollMs, remaining))
  }

  return {
    complete: false,
    timedOut: true,
    attempts: attempts,
    lastResult: lastResult,
    stoppingPoint: 'waiting_for_proof',
  }
}

/**
 * Continue chain after NOC exists: Proof send → wait → eRecord prep
 */
async function continueAfterNocGenerated(jobId, options) {
  var opts = options || {}
  var result = {
    jobId: jobId,
    phases: {},
    stoppingPoint: null,
  }

  var job = await reloadJob(jobId)

  if (!hasGeneratedNoc(job)) {
    result.stoppingPoint = 'noc_missing'
    result.phases.noc = { skipped: true, reason: 'generated NOC not found' }
    return result
  }

  // Proof send (auto if all gates pass)
  if (!isProofInFlight(job) && !hasNotarizedPdf(job)) {
    var gate = evaluateProofSendGate(job)
    result.phases.proofSendGate = gate

    if (gate.allowed) {
      console.log('[chain] Auto-triggering Proof send for job ' + jobId)
      result.phases.proofSend = await sendNocToProof(jobId, opts)
      job = await reloadJob(jobId)
    } else {
      result.phases.proofSend = {
        success: false,
        skipped: true,
        reason: gate.reasons.join('; '),
        autoBlocked: true,
      }
      result.stoppingPoint = 'proof_send_gated'
      return result
    }
  } else {
    result.phases.proofSend = {
      skipped: true,
      reason: hasNotarizedPdf(job) ? 'notarized PDF already exists' : 'Proof already in flight',
      transaction_id: getProofTransactionId(job),
      noc_status: job.noc_status,
    }
  }

  if (result.phases.proofSend && result.phases.proofSend.skipped && result.phases.proofSend.autoBlocked) {
    return result
  }

  if (result.phases.proofSend && result.phases.proofSend.skipped && !isProofInFlight(job) && !hasNotarizedPdf(job)) {
    result.stoppingPoint = 'proof_send_skipped'
    return result
  }

  // Wait for Proof completion (includes eRecord queue + prep on success)
  if (isProofInFlight(job) && !hasNotarizedPdf(job)) {
    if (opts.waitForProofCompletion !== false) {
      console.log('[chain] Waiting for Proof notarization...')
      result.phases.proofComplete = await waitForProofCompletionAndContinue(jobId, opts)
      result.stoppingPoint = result.phases.proofComplete.stoppingPoint || 'waiting_for_proof'
    } else {
      result.stoppingPoint = 'waiting_for_proof'
      result.phases.proofComplete = { skipped: true, reason: 'waitForProofCompletion=false' }
    }
    return result
  }

  // eRecord prep if notarized but not yet prepared
  if (hasNotarizedPdf(job) && !isReadyForErecordReview(job)) {
    console.log('[chain] Continuing to eRecord prep...')
    result.phases.erecord = await continueToErecordPrep(jobId, opts)
    job = await reloadJob(jobId)
    result.stoppingPoint = isReadyForErecordReview(job)
      ? 'ready_for_erecord_review'
      : 'queued_for_erecord'
    return result
  }

  if (isReadyForErecordReview(job)) {
    result.stoppingPoint = 'ready_for_erecord_review'
  } else if (hasNotarizedPdf(job)) {
    result.stoppingPoint = 'queued_for_erecord'
  } else {
    result.stoppingPoint = 'waiting_for_proof'
  }

  return result
}

/**
 * Full chain after AHJ Phase 1:
 * NOC generate → Proof send (if gates pass) → wait for notarization → eRecord prep
 */
async function runPostPhase1Chain(jobId, options) {
  var opts = options || {}
  var result = {
    jobId: jobId,
    startedAt: new Date().toISOString(),
    phases: {},
    stoppingPoint: null,
  }

  var job = await reloadJob(jobId)

  if (!isPhase1Complete(job)) {
    result.stoppingPoint = 'phase1_incomplete'
    result.phases.phase1 = {
      skipped: true,
      reason: 'parcel_number, legal_description, and portal_confirmation required',
      parcel_number: !!job.parcel_number,
      legal_description: !!job.legal_description,
      portal_confirmation: !!job.portal_confirmation,
    }
    return result
  }

  if (!hasGeneratedNoc(job) || job.noc_status === 'not_started' || job.noc_status === 'error') {
    console.log('[chain] Starting NOC generation + downstream chain for job ' + jobId)
    var nocPhase = await startNocPhaseForJob(jobId, opts)
    result.phases.noc = nocPhase.pipeline || nocPhase
    if (nocPhase.chain) {
      result.phases = Object.assign(result.phases, nocPhase.chain.phases || {})
      result.stoppingPoint = nocPhase.chain.stoppingPoint
    } else {
      result.stoppingPoint = 'noc_generated'
    }
    return result
  }

  result.phases.noc = {
    skipped: true,
    reason: 'NOC already generated',
    noc_file_path: job.noc_file_path,
    noc_status: job.noc_status,
  }

  var continued = await continueAfterNocGenerated(jobId, opts)
  result.phases = Object.assign(result.phases, continued.phases)
  result.stoppingPoint = continued.stoppingPoint
  return result
}

module.exports = {
  isPhase1Complete,
  hasGeneratedNoc,
  isProofInFlight,
  hasNotarizedPdf,
  isReadyForErecordReview,
  startNocPhaseForJob,
  continueToErecordPrep,
  continueAfterNocGenerated,
  waitForProofCompletionAndContinue,
  runPostPhase1Chain,
}
