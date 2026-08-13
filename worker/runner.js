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

var PERMIT_RUN_TYPES = ['permit_phase_1', 'permit_resume', 'permit_submit', 'permit_document_upload']

var verifiedPaths = verifyPolkRunnerUsesDirectTrigger()
console.log('[worker] Project root:', getProjectRoot())
console.log('[worker] Polk runner:', verifiedPaths.polkPath)
console.log('[worker] NOC trigger module:', verifiedPaths.nocTriggerPath)

function deriveRunType(job) {
  if (job.noc_status === 'queued_for_erecord') return 'erecord_prepare'
  if (job.noc_status === 'notarized') return 'erecord_prepare'
  return 'permit_phase_1'
}

function loadPolkRunner() {
  var polkRunnerPath = resolveFromRoot('automation/ahjs/polk-county.runner.js')
  return require(polkRunnerPath)
}

function loadLeeRunner() {
  var leeRunnerPath = resolveFromRoot('automation/ahjs/lee-county.runner.js')
  return require(leeRunnerPath)
}

function loadHillsboroughRunner() {
  var hillsboroughRunnerPath = resolveFromRoot('automation/ahjs/hillsborough-county.runner.js')
  return require(hillsboroughRunnerPath)
}

function loadPinellasRunner() {
  var pinellasRunnerPath = resolveFromRoot('automation/ahjs/pinellas-county.runner.js')
  return require(pinellasRunnerPath)
}

function loadPascoRunner() {
  var pascoRunnerPath = resolveFromRoot('automation/ahjs/pasco-county.runner.js')
  return require(pascoRunnerPath)
}

function loadSarasotaRunner() {
  var sarasotaRunnerPath = resolveFromRoot('automation/ahjs/sarasota-county.runner.js')
  return require(sarasotaRunnerPath)
}

function loadCharlotteRunner() {
  var charlotteRunnerPath = resolveFromRoot('automation/ahjs/charlotte-county.runner.js')
  return require(charlotteRunnerPath)
}

function loadLakeRunner() {
  var lakeRunnerPath = resolveFromRoot('automation/ahjs/lake-county.runner.js')
  return require(lakeRunnerPath)
}

function loadManateeRunner() {
  var manateeRunnerPath = resolveFromRoot('automation/ahjs/manatee-county.runner.js')
  return require(manateeRunnerPath)
}

function loadBrevardRunner() {
  var brevardRunnerPath = resolveFromRoot('automation/ahjs/brevard-county.runner.js')
  return require(brevardRunnerPath)
}

function loadOsceolaRunner() {
  var osceolaRunnerPath = resolveFromRoot('automation/ahjs/osceola-county.runner.js')
  return require(osceolaRunnerPath)
}

function loadCitrusRunner() {
  var citrusRunnerPath = resolveFromRoot('automation/ahjs/citrus-county.runner.js')
  return require(citrusRunnerPath)
}

async function loadAhjForJob(job) {
  if (!job.ahj_id) {
    throw new Error('Job ' + job.id + ' has no AHJ assigned')
  }

  var { data: ahj, error } = await supabase
    .from('ahj_portals')
    .select('id, name, workflow_file, credential_key')
    .eq('id', job.ahj_id)
    .single()

  if (error || !ahj) {
    throw new Error('AHJ not found for job ' + job.id + ': ' + (error && error.message ? error.message : job.ahj_id))
  }

  return ahj
}

async function runPermitWorkflow(job, run) {
  var runId = run && typeof run === 'object' ? run.id : run
  var runRecord = run && typeof run === 'object' ? run : { id: runId, run_type: null, payload: {} }
  var ahj = await loadAhjForJob(job)
  console.log('[worker] AHJ:', ahj.name, 'workflow:', ahj.workflow_file)

  switch (ahj.workflow_file) {
    case 'polk-county.runner.js': {
      var polkRunType = runRecord.run_type || deriveRunType(job)
      if (polkRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Polk permit_submit is disabled; Phase 2 stops at Review and requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runPolkCounty } = loadPolkRunner()
      await runPolkCounty(job, runId, {
        runType: polkRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'lee-county.runner.js': {
      var { runLeeCounty } = loadLeeRunner()
      await runLeeCounty(job, runId)
      return
    }
    case 'hillsborough-county.runner.js': {
      var hillsRunType = runRecord.run_type || deriveRunType(job)
      if (hillsRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Hillsborough permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runHillsboroughCounty } = loadHillsboroughRunner()
      await runHillsboroughCounty(job, runId, {
        runType: hillsRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'pinellas-county.runner.js': {
      var pinellasRunType = runRecord.run_type || deriveRunType(job)
      if (pinellasRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Pinellas permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runPinellasCounty } = loadPinellasRunner()
      await runPinellasCounty(job, runId, {
        runType: pinellasRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'pasco-county.runner.js': {
      var pascoRunType = runRecord.run_type || deriveRunType(job)
      if (pascoRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Pasco permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runPascoCounty } = loadPascoRunner()
      await runPascoCounty(job, runId, {
        runType: pascoRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'sarasota-county.runner.js': {
      var sarasotaRunType = runRecord.run_type || deriveRunType(job)
      if (sarasotaRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Sarasota permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runSarasotaCounty } = loadSarasotaRunner()
      await runSarasotaCounty(job, runId, {
        runType: sarasotaRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'charlotte-county.runner.js': {
      var charlotteRunType = runRecord.run_type || deriveRunType(job)
      if (charlotteRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Charlotte permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runCharlotteCounty } = loadCharlotteRunner()
      await runCharlotteCounty(job, runId, {
        runType: charlotteRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'lake-county.runner.js': {
      var lakeRunType = runRecord.run_type || deriveRunType(job)
      if (lakeRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Lake County permit_submit is disabled; OPRS submit is not automated'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runLakeCounty } = loadLakeRunner()
      await runLakeCounty(job, runId, {
        runType: lakeRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'manatee-county.runner.js': {
      var manateeRunType = runRecord.run_type || deriveRunType(job)
      if (manateeRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Manatee permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runManateeCounty } = loadManateeRunner()
      await runManateeCounty(job, runId, {
        runType: manateeRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'brevard-county.runner.js': {
      var brevardRunType = runRecord.run_type || deriveRunType(job)
      if (brevardRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Brevard permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runBrevardCounty } = loadBrevardRunner()
      await runBrevardCounty(job, runId, {
        runType: brevardRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'osceola-county.runner.js': {
      var osceolaRunType = runRecord.run_type || deriveRunType(job)
      if (osceolaRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Osceola permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runOsceolaCounty } = loadOsceolaRunner()
      await runOsceolaCounty(job, runId, {
        runType: osceolaRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    case 'citrus-county.runner.js': {
      var citrusRunType = runRecord.run_type || deriveRunType(job)
      if (citrusRunType === 'permit_submit') {
        throw Object.assign(
          new Error('Citrus permit_submit is disabled; Accela submit/payment requires human approval'),
          { errorCode: 'unsupported_run_type' }
        )
      }
      var { runCitrusCounty } = loadCitrusRunner()
      await runCitrusCounty(job, runId, {
        runType: citrusRunType,
        runPayload: runRecord.payload || {},
      })
      return
    }
    default:
      throw new Error('No runner found for workflow file: ' + ahj.workflow_file)
  }
}

async function releaseRunToQueue(runId) {
  await supabase.from('automation_runs').update({
    run_status: 'queued',
    started_at: new Date().toISOString(),
  }).eq('id', runId).eq('run_status', 'running')
}

async function executeRun(job, run) {
  var runId = run && run.id ? run.id : run
  var runRecord = typeof run === 'object' && run !== null ? run : { id: runId, run_type: null }

  try {
    var runType = runRecord.run_type || deriveRunType(job)
    console.log('[worker] Executing run:', runId, 'run_type:', runType, 'job:', job.property_address)

    if (PERMIT_RUN_TYPES.indexOf(runType) < 0) {
      console.log('[worker] Skipping run ' + runId + ' — run_type=' + runType + ' (Worker 2 handles this)')
      await releaseRunToQueue(runId)
      return
    }

    await runPermitWorkflow(job, runRecord)

    console.log('[worker] Run complete:', runId)
  } catch (err) {
    console.error('[worker] Run failed:', err.message)
    await supabase.from('automation_logs').insert({ run_id: runId, step_number: 99, step_name: 'error', success: false, notes: err.message, raw_error: err.stack || '' })
    await supabase.from('automation_runs').update({ run_status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).eq('id', runId)
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', job.id)
  }
}

module.exports = {
  executeRun,
  loadPolkRunner,
  loadLeeRunner,
  loadHillsboroughRunner,
  loadPinellasRunner,
  loadPascoRunner,
  loadSarasotaRunner,
  loadCharlotteRunner,
  loadLakeRunner,
  loadManateeRunner,
  loadBrevardRunner,
  loadOsceolaRunner,
  loadCitrusRunner,
  runPermitWorkflow,
  verifyPolkRunnerUsesDirectTrigger,
  deriveRunType,
  PERMIT_RUN_TYPES,
}
