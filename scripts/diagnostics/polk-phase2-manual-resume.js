/**
 * ONE-OFF: Polk Phase 2 live dry-run against Accela draft 26TMP-043760.
 *
 * Calls runPolkCounty(...) directly — bypasses the automation_runs queue claim path.
 * MUST NEVER be imported by worker/index.js, worker/runner.js, or any automatic
 * processing path. Founder-operated only.
 *
 * Prerequisites (Option A):
 *   - Test job + automation_runs row already exist (run_status = running, not queued)
 *   - Queue otherwise empty / no new queued runs will be added
 *   - platform_settings.automation_enabled briefly ON (runner fail-closed requires it)
 *   - Gate flipped OFF again immediately after this script exits
 *
 * Usage (only after explicit go-ahead):
 *   POLK_PHASE2_MANUAL_GO=1 \
 *   SEALED_JOB_ID=<job-uuid> \
 *   SEALED_RUN_ID=<run-uuid> \
 *   JOB_ID=<same-job-uuid> \
 *   RUN_ID=<same-run-uuid> \
 *   node scripts/diagnostics/polk-phase2-manual-resume.js
 *
 * JOB_ID / RUN_ID must exactly match SEALED_JOB_ID / SEALED_RUN_ID (dual-env seal).
 */
'use strict'

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') })

const { createClient } = require('@supabase/supabase-js')
const { isAutomationEnabled } = require('../../lib/automation/automation-gate.js')
const { runPolkCounty } = require('../../automation/ahjs/polk-county.runner.js')

const EXPECTED_DRAFT = '26TMP-043760'
const EXPECTED_COMPANY_ID = 'd34dd732-ae39-450d-b717-a787c1fba408'
const EXPECTED_AHJ_ID = '6d54bac8-9306-4fb4-b042-fbe086c007f2'

function requireEnv(name) {
  var value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error('Missing required env: ' + name)
  }
  return String(value).trim()
}

function getSupabase() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  var ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (!ref || ref[1] !== 'yhxzwjoouiurxrmhjslg') {
    throw new Error('Refusing to run: Supabase URL is not production yhxzwjoouiurxrmhjslg')
  }
  return createClient(url, key)
}

async function main() {
  if (process.env.POLK_PHASE2_MANUAL_GO !== '1') {
    console.error('Refusing to start: set POLK_PHASE2_MANUAL_GO=1 after explicit founder go-ahead.')
    process.exit(2)
  }

  var sealedJobId = requireEnv('SEALED_JOB_ID')
  var sealedRunId = requireEnv('SEALED_RUN_ID')
  var jobId = requireEnv('JOB_ID')
  var runId = requireEnv('RUN_ID')
  if (jobId !== sealedJobId) {
    throw new Error('JOB_ID does not match the sealed Phase 2 test job id (SEALED_JOB_ID)')
  }
  if (runId !== sealedRunId) {
    throw new Error('RUN_ID does not match the sealed Phase 2 test run id (SEALED_RUN_ID)')
  }

  var supabase = getSupabase()

  var gateOn = await isAutomationEnabled(supabase)
  if (!gateOn) {
    throw new Error(
      'Automation gate is OFF. Option A requires briefly enabling platform_settings.automation_enabled ' +
      'before this script (no runner gate-bypass exists).'
    )
  }

  var jobResult = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (jobResult.error || !jobResult.data) {
    throw new Error('Failed to load job: ' + (jobResult.error && jobResult.error.message))
  }
  var job = jobResult.data
  if (job.company_id !== EXPECTED_COMPANY_ID) {
    throw new Error('Job company_id is not Gator — aborting')
  }
  if (job.ahj_id !== EXPECTED_AHJ_ID) {
    throw new Error('Job ahj_id is not Polk — aborting')
  }
  if (!/TEST ONLY — Polk Phase 2 live dry-run against Accela draft 26TMP-043760/i.test(job.internal_notes || '')) {
    throw new Error('Job internal_notes missing TEST ONLY marker — aborting')
  }

  var runResult = await supabase
    .from('automation_runs')
    .select('id, job_id, run_type, run_status, payload')
    .eq('id', runId)
    .single()
  if (runResult.error || !runResult.data) {
    throw new Error('Failed to load automation_runs row: ' + (runResult.error && runResult.error.message))
  }
  var run = runResult.data
  if (run.job_id !== jobId) throw new Error('Run job_id does not match JOB_ID')
  if (run.run_type !== 'permit_resume') throw new Error('Run run_type must be permit_resume')
  if (run.run_status === 'queued') {
    throw new Error('Run is queued — refusing (worker could also claim it). Keep status running.')
  }
  if (run.run_type === 'permit_submit') {
    throw new Error('Polk permit_submit is disabled; Phase 2 stops at Review')
  }
  var portalRecord =
    run.payload && typeof run.payload.portal_record_number === 'string'
      ? run.payload.portal_record_number.trim()
      : ''
  if (portalRecord !== EXPECTED_DRAFT) {
    throw new Error('Run payload.portal_record_number must be ' + EXPECTED_DRAFT)
  }

  // Soft check: no other queued rows that a gate-on worker could grab
  var queued = await supabase
    .from('automation_runs')
    .select('id, job_id, run_type, run_status')
    .eq('run_status', 'queued')
  if (queued.error) throw new Error('Queued-run precheck failed: ' + queued.error.message)
  if ((queued.data || []).length > 0) {
    throw new Error(
      'Refusing to start: found ' + queued.data.length +
      ' queued automation_runs row(s). Empty the queue or keep the gate off.'
    )
  }

  console.log('========================================')
  console.log('POLK PHASE 2 MANUAL RESUME (ONE-OFF)')
  console.log('========================================')
  console.log('Job:', job.id)
  console.log('Run:', run.id)
  console.log('Draft:', portalRecord)
  console.log('Owner:', job.owner_name)
  console.log('Address:', job.property_address, job.property_city, job.property_state, job.property_zip)
  console.log('Gate: ON (Option A — flip OFF immediately after)')
  console.log('========================================\n')

  await runPolkCounty(job, runId, {
    runType: 'permit_resume',
    runPayload: {
      portal_record_number: EXPECTED_DRAFT,
    },
  })

  console.log('\nManual Phase 2 invocation finished (expect needs_review / Review hard stop).')
}

main().catch(function (err) {
  console.error('\n✗ polk-phase2-manual-resume failed:', err.message)
  if (err.errorCode) console.error('  errorCode:', err.errorCode)
  process.exit(1)
})
