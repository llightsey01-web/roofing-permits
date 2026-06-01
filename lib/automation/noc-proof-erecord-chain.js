// lib/automation/noc-proof-erecord-chain.js
// Full post–Phase 1 chain including Proof completion polling (worker / CLI only)

const core = require('./noc-after-noc-core')

async function startNocPhaseForJob(jobId, options) {
  var mod = await import('../noc/start-noc.js')
  return mod.startNocPhaseForJob(jobId, options)
}

async function runPostPhase1Chain(jobId, options) {
  var opts = options || {}
  if (opts.waitForProofCompletion !== false && !opts.waitForProofCompletionFn) {
    var waitMod = require('./proof-completion-wait.js')
    opts.waitForProofCompletionFn = waitMod.waitForProofCompletionAndContinue
  }
  var result = {
    jobId: jobId,
    startedAt: new Date().toISOString(),
    phases: {},
    stoppingPoint: null,
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

  if (!core.hasGeneratedNoc(job) || job.noc_status === 'not_started' || job.noc_status === 'error') {
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

  var continued = await core.continueAfterNocGenerated(jobId, opts)
  result.phases = Object.assign(result.phases, continued.phases)
  result.stoppingPoint = continued.stoppingPoint
  return result
}

module.exports = Object.assign({}, core, {
  startNocPhaseForJob,
  runPostPhase1Chain,
})
