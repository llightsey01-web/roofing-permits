// lib/automation/noc-proof-erecord-chain.js
// Full post–Phase 1 chain including Proof completion polling (worker / CLI only)

const path = require('path')
const { pathToFileURL } = require('url')
const core = require('./noc-after-noc-core')

const runNocPhaseUrl = pathToFileURL(path.join(__dirname, '../noc/run-noc-phase.js')).href

async function startNocPhaseForJob(jobId, options) {
  var runMod = await import(runNocPhaseUrl)
  var runNocPhaseForJob = runMod.runNocPhaseForJob || runMod.default.runNocPhaseForJob
  var phase = await runNocPhaseForJob(jobId, options)
  var chainResult = await core.continueAfterNocGenerated(jobId, options)

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
  if (opts.waitForProofCompletion !== false && !opts.waitForProofCompletionFn) {
    var waitMod = await import('./proof-completion-wait.js')
    var waitFns = waitMod.default || waitMod
    opts.waitForProofCompletionFn = waitFns.waitForProofCompletionAndContinue
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
