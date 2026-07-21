// lib/automation/noc-proof-erecord-chain.js
// Full post–Phase 1 chain including Proof completion polling (worker / CLI only)

const { createClient } = require('@supabase/supabase-js')
const core = require('./noc-after-noc-core')
const { runNocPhaseForJob } = require('../noc/run-noc-phase.js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function shouldUseRunQueue(options) {
  var opts = options || {}
  if (opts.useRunQueue === false) return false
  if (opts.useRunQueue === true) return true
  return process.env.AUTOMATION_QUEUE_RUNS === 'true'
}

async function queueAutomationRun(jobId, runType, dependencyRunId, payload) {
  var supabase = getSupabase()
  var { data: run, error } = await supabase.from('automation_runs').insert({
    job_id: jobId,
    run_type: runType,
    run_status: 'queued',
    dependency_run_id: dependencyRunId || null,
    payload: payload || {},
    started_at: new Date().toISOString(),
  }).select('id, run_type, job_id').single()

  if (error) throw new Error('Failed to queue ' + runType + ' run: ' + error.message)
  console.log('[chain] Queued run_type=' + runType + ' runId=' + run.id + ' jobId=' + jobId)
  return run
}

async function queueNocGenerateRun(jobId, dependencyRunId, options) {
  return queueAutomationRun(jobId, 'noc_generate', dependencyRunId, {
    source: 'post_phase_1',
    options: options || {},
  })
}

async function queueProofSendRun(jobId, dependencyRunId, options) {
  return queueAutomationRun(jobId, 'proof_send', dependencyRunId, {
    source: 'after_noc_generate',
    options: options || {},
  })
}

async function queueProofCheckRun(jobId, dependencyRunId, options) {
  return queueAutomationRun(jobId, 'proof_check', dependencyRunId, {
    source: 'after_proof_send',
    options: options || {},
  })
}

async function queueErecordPrepareRun(jobId, dependencyRunId, options) {
  return queueAutomationRun(jobId, 'erecord_prepare', dependencyRunId, {
    source: 'after_proof_complete',
    options: options || {},
  })
}

async function maybePauseForReviewGate(job, reviewType, jobUpdate) {
  var supabase = getSupabase()
  if (!job.company_id) return { gated: false }

  var { data: company } = await supabase
    .from('companies')
    .select('review_gates')
    .eq('id', job.company_id)
    .single()

  var gates = company?.review_gates || {}
  var gateEnabled = reviewType === 'noc_before_send'
    ? gates.noc_before_send
    : gates.permit_before_submit

  if (!gateEnabled || gates.auto_approve_all) {
    return { gated: false }
  }

  var { data: existing } = await supabase
    .from('review_requests')
    .select('id')
    .eq('job_id', job.id)
    .eq('review_type', reviewType)
    .eq('review_status', 'pending')
    .maybeSingle()

  if (!existing) {
    await supabase.from('review_requests').insert({
      job_id: job.id,
      company_id: job.company_id,
      review_type: reviewType,
      review_status: 'pending',
    })
  }

  await supabase.from('jobs').update(jobUpdate).eq('id', job.id)
  console.log('[chain] ' + reviewType + ' gate active — waiting for contractor review')

  return {
    gated: true,
    stoppingPoint: reviewType + '_gate',
    review_type: reviewType,
  }
}

async function queueDownstreamAfterNoc(jobId, nocRunId, options) {
  var opts = options || {}
  var job = await core.reloadJob(jobId)

  if (!core.hasGeneratedNoc(job)) {
    return { queued: false, reason: 'noc_not_generated' }
  }

  if (core.isProofInFlight(job) || core.hasNotarizedPdf(job)) {
    return { queued: false, reason: 'proof_already_in_flight_or_complete' }
  }

  var nocGate = await maybePauseForReviewGate(job, 'noc_before_send', {
    job_status: 'needs_review',
    noc_status: 'queued_for_notarization',
  })

  if (nocGate.gated) {
    return { queued: false, gated: true, stoppingPoint: nocGate.stoppingPoint }
  }

  job = await core.reloadJob(jobId)
  var { evaluateProofSendGateAsync } = require('../proof/send-noc-to-proof')
  var gate = await evaluateProofSendGateAsync(job)
  if (!gate.allowed) {
    return {
      queued: false,
      stoppingPoint: 'proof_send_gated',
      reason: gate.reasons.join('; '),
    }
  }

  var proofRun = await queueProofSendRun(jobId, nocRunId, opts)
  return { queued: true, run: proofRun, run_type: 'proof_send' }
}

async function startNocPhaseForJob(jobId, options) {
  var opts = options || {}

  if (shouldUseRunQueue(opts) && opts.currentRunId) {
    var phase = await runNocPhaseForJob(jobId, opts)
    if (phase && phase.needsManualReview) {
      return {
        success: false,
        needsManualReview: true,
        jobId: phase.jobId,
        status: phase.status,
        nocStatus: phase.nocStatus,
        message: phase.message,
        overflows: phase.overflows,
        pipeline: phase.pipeline,
        queued: { queued: false, reason: 'noc_template_capacity' },
      }
    }
    var queued = await queueDownstreamAfterNoc(jobId, opts.currentRunId, opts)
    return {
      success: true,
      jobId: phase.jobId,
      status: phase.status,
      nocStatus: phase.nocStatus,
      nocFilePath: phase.nocFilePath,
      pipeline: phase.pipeline,
      queued: queued,
    }
  }

  var phase = await runNocPhaseForJob(jobId, opts)
  if (phase && phase.needsManualReview) {
    return {
      success: false,
      needsManualReview: true,
      jobId: phase.jobId,
      status: phase.status,
      nocStatus: phase.nocStatus,
      message: phase.message,
      overflows: phase.overflows,
      pipeline: phase.pipeline,
      chain: { stoppingPoint: 'noc_template_capacity', needsManualReview: true },
    }
  }
  var chainResult = await core.continueAfterNocGenerated(jobId, opts)

  return {
    success: true,
    jobId: phase.jobId,
    status: phase.status,
    nocStatus: phase.nocStatus,
    nocFilePath: phase.nocFilePath,
    pipeline: phase.pipeline,
    chain: chainResult,
  }
}

async function runPostPhase1Chain(jobId, options) {
  var opts = options || {}
  if (opts.waitForProofCompletion !== false && !opts.waitForProofCompletionFn && !shouldUseRunQueue(opts)) {
    var waitMod = require('./proof-completion-wait.js')
    opts.waitForProofCompletionFn = waitMod.waitForProofCompletionAndContinue
  }

  var result = {
    jobId: jobId,
    startedAt: new Date().toISOString(),
    phases: {},
    stoppingPoint: null,
    useRunQueue: shouldUseRunQueue(opts),
  }

  var job = await core.reloadJob(jobId)

  if (!core.isPhase1Complete(job)) {
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

  if (shouldUseRunQueue(opts)) {
    console.log('[chain] Queueing noc_generate run for job ' + jobId)
    var nocRun = await queueNocGenerateRun(jobId, opts.currentRunId || null, opts)
    result.phases.nocGenerateQueued = { runId: nocRun.id, run_type: nocRun.run_type }
    result.stoppingPoint = 'noc_generate_queued'
    return result
  }

  if (!core.hasGeneratedNoc(job) || job.noc_status === 'not_started' || job.noc_status === 'error') {
    console.log('[chain] Starting NOC generation + downstream chain for job ' + jobId)
    var nocPhase = await startNocPhaseForJob(jobId, opts)
    result.phases.noc = nocPhase.pipeline || nocPhase
    if (nocPhase.chain) {
      result.phases = Object.assign(result.phases, nocPhase.chain.phases || {})
      result.stoppingPoint = nocPhase.chain.stoppingPoint
    } else if (nocPhase.queued) {
      result.phases.proofSendQueued = nocPhase.queued
      result.stoppingPoint = nocPhase.queued.stoppingPoint || 'proof_send_queued'
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

  var continued = await core.continueAfterNocGenerated(jobId, opts)
  result.phases = Object.assign(result.phases, continued.phases)
  result.stoppingPoint = continued.stoppingPoint
  return result
}

module.exports = Object.assign({}, core, {
  getSupabase,
  shouldUseRunQueue,
  queueAutomationRun,
  queueNocGenerateRun,
  queueProofSendRun,
  queueProofCheckRun,
  queueErecordPrepareRun,
  queueDownstreamAfterNoc,
  startNocPhaseForJob,
  runPostPhase1Chain,
})
