require('dotenv').config({ path: '.env.local' })

const { join } = require('path')
const { writeFileSync, mkdirSync } = require('fs')
const { createClient } = require('@supabase/supabase-js')
const { runPolkCounty } = require('./ahjs/polk-county.runner')
const {
  runPostPhase1Chain,
  isPhase1Complete,
  isReadyForErecordReview,
} = require('../lib/automation/noc-proof-erecord-chain')
const { SendPackageSafetyError } = require('../lib/epn/submit-safety')

var VISUAL_OPTS = { headless: false, slowMo: 250, waitForProofCompletion: true }

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function parseArgs(argv) {
  var jobId = null
  var flags = { skipPolk: false, chainOnly: false }
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--skip-polk') flags.skipPolk = true
    else if (argv[i] === '--chain-only') flags.chainOnly = true
    else if (!argv[i].startsWith('--') && !jobId) jobId = argv[i]
  }
  return { jobId: jobId, flags: flags }
}

async function reloadJob(supabase, jobId) {
  var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) throw new Error('Job not found: ' + jobId)
  return job
}

async function createAutomationRun(supabase, jobId) {
  var { data: run, error } = await supabase
    .from('automation_runs')
    .insert({ job_id: jobId, run_status: 'running', started_at: new Date().toISOString() })
    .select()
    .single()
  if (error) throw new Error('Failed to create automation run: ' + error.message)
  return run.id
}

async function loadJobDocuments(supabase, jobId) {
  var { data: docs } = await supabase
    .from('job_documents')
    .select('document_type, file_name, file_path')
    .eq('job_id', jobId)
  return docs || []
}

async function main() {
  var parsed = parseArgs(process.argv.slice(2))
  var jobId = parsed.jobId
  var flags = parsed.flags

  if (!jobId) {
    console.error('Usage: node automation/test-end-to-end-visual.js <jobId> [--skip-polk] [--chain-only]')
    process.exit(1)
  }

  var outputDir = join('automation', 'logs', 'e2e-visual-' + jobId + '-' + Date.now())
  mkdirSync(outputDir, { recursive: true })

  var supabase = getSupabase()
  var job = await reloadJob(supabase, jobId)

  var report = {
    jobId: jobId,
    outputDir: outputDir,
    visualOptions: VISUAL_OPTS,
    safetyRules: { sendPackageClicked: false, liveSubmit: false, permitFinalSubmit: false },
    phases: {},
    stoppingPoint: null,
    chainResult: null,
  }

  console.log('========================================')
  console.log('CONTROLLED VISUAL END-TO-END TEST')
  console.log('========================================')
  console.log('Job ID: ' + jobId)
  console.log('Output: ' + outputDir)
  console.log('Chained automation: Phase1 → NOC → Proof → eRecord prep')
  console.log('HARD RULES: no #SendPackage, no live ePN submit, no permit final submit')
  console.log('========================================\n')

  report.phases.initial = {
    noc_status: job.noc_status,
    job_status: job.job_status,
    phase1_complete: isPhase1Complete(job),
  }

  if (!flags.chainOnly && !flags.skipPolk && !isPhase1Complete(job)) {
    try {
      var documents = await loadJobDocuments(supabase, jobId)
      var runId = await createAutomationRun(supabase, jobId)
      await runPolkCounty(Object.assign({}, job, { documents: documents }), runId, Object.assign({}, VISUAL_OPTS, {
        skipPostPhase1Chain: true,
      }))
      job = await reloadJob(supabase, jobId)
      report.phases.polk_phase1 = {
        status: 'completed',
        parcel_number: job.parcel_number,
        portal_confirmation: !!job.portal_confirmation,
        legal_description: !!job.legal_description,
      }
    } catch (polkErr) {
      report.phases.polk_phase1 = { status: 'failed', error: polkErr.message }
      report.stoppingPoint = 'polk_phase1_failed'
      writeFileSync(join(outputDir, 'e2e-report.json'), JSON.stringify(report, null, 2))
      throw polkErr
    }
  } else {
    report.phases.polk_phase1 = {
      status: 'skipped',
      reason: flags.chainOnly ? '--chain-only' : (flags.skipPolk ? '--skip-polk' : 'phase1 already complete'),
    }
  }

  var chainResult = await runPostPhase1Chain(jobId, Object.assign({ outputDir: outputDir }, VISUAL_OPTS))
  report.chainResult = chainResult
  report.phases.chain = chainResult.phases
  report.stoppingPoint = chainResult.stoppingPoint

  job = await reloadJob(supabase, jobId)
  report.finalDbState = {
    noc_status: job.noc_status,
    job_status: job.job_status,
    noc_file_path: job.noc_file_path,
    notarized_file_path: job.job_specs?.proof?.notarized_file_path || null,
    proof_transaction_id: job.job_specs?.proof?.transaction_id || null,
    erecord_status: job.job_specs?.erecord?.status || null,
    erecord_package_id: job.job_specs?.erecord?.package_id || null,
    erecord_document_status: job.job_specs?.erecord?.document_status || null,
    live_submit_required: job.job_specs?.erecord?.live_submit_required || false,
  }

  writeFileSync(join(outputDir, 'e2e-report.json'), JSON.stringify(report, null, 2))

  console.log('\n========================================')
  console.log('E2E VISUAL TEST REPORT')
  console.log('========================================')
  console.log('Job ID: ' + jobId)
  console.log('Log folder: ' + outputDir)
  console.log('Stopping point: ' + report.stoppingPoint)
  console.log('Final noc_status: ' + report.finalDbState.noc_status)
  console.log('eRecord status: ' + (report.finalDbState.erecord_status || 'not started'))
  console.log('#SendPackage clicked: false')
  if (isReadyForErecordReview(job)) {
    console.log('Ready for eRecording Review — packId ' + (report.finalDbState.erecord_package_id || 'n/a'))
  }
}

main().catch(function(err) {
  if (err instanceof SendPackageSafetyError) {
    console.error('Safety violation:', err.message)
    process.exit(2)
  }
  console.error('E2E visual test failed:', err.message)
  process.exit(1)
})
