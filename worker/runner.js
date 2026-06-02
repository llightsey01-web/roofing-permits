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

var PERMIT_RUN_TYPES = ['permit_phase_1', 'permit_resume', 'permit_submit']

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

async function runPermitWorkflow(job, runId) {
  var ahj = await loadAhjForJob(job)
  console.log('[worker] AHJ:', ahj.name, 'workflow:', ahj.workflow_file)

  switch (ahj.workflow_file) {
    case 'polk-county.runner.js': {
      var { runPolkCounty } = loadPolkRunner()
      await runPolkCounty(job, runId)
      return
    }
    case 'lee-county.runner.js': {
      var { runLeeCounty } = loadLeeRunner()
      await runLeeCounty(job, runId)
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

    await runPermitWorkflow(job, runId)

    console.log('[worker] Run complete:', runId)
  } catch (err) {
    console.error('[worker] Run failed:', err.message)
    await supabase.from('automation_logs').insert({ run_id: runId, step_number: 99, step_name: 'error', success: false, notes: err.message, raw_error: err.stack || '' })
    await supabase.from('automation_runs').update({ run_status: 'error', error_message: err.message, completed_at: new Date().toISOString() }).eq('id', runId)
    await supabase.from('jobs').update({ job_status: 'needs_correction' }).eq('id', job.id)
  }
}

module.exports = { executeRun, loadPolkRunner, loadLeeRunner, runPermitWorkflow, verifyPolkRunnerUsesDirectTrigger, deriveRunType, PERMIT_RUN_TYPES }
