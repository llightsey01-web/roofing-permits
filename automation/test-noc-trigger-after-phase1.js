require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')
const {
  triggerNocAfterPhase1Direct,
  callNocStartApi,
} = require('../lib/automation/noc-trigger')
const { getAppBaseUrl } = require('../lib/app-base-url')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function parseArgs(argv) {
  var jobId = process.env.JOB_ID || null
  var testApi = false
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--test-api') testApi = true
    else if (!argv[i].startsWith('--') && !jobId) jobId = argv[i]
  }
  return { jobId: jobId, testApi: testApi }
}

function printJobSummary(job, source) {
  console.log('\n--- Selected job (' + source + ') ---')
  console.log('  id:               ' + job.id)
  console.log('  owner_name:       ' + (job.owner_name || '(none)'))
  console.log('  property_address: ' + (job.property_address || '(none)'))
  console.log('  city:             ' + (job.property_city || '(none)'))
  console.log('  state:            ' + (job.property_state || '(none)'))
  console.log('  zip:              ' + (job.property_zip || '(none)'))
  console.log('  job_status:       ' + (job.job_status || '(none)'))
  console.log('  noc_status:       ' + (job.noc_status || '(none)'))
  console.log('  parcel_number:    ' + (job.parcel_number || '(none)'))
  console.log('  legal_description:' + (job.legal_description ? ' ' + job.legal_description : ' (none)'))
}

function hasRequiredNocFields(job) {
  return !!(
    job.parcel_number && String(job.parcel_number).trim() &&
    job.legal_description && String(job.legal_description).trim()
  )
}

async function findNewestUsableJob(supabase) {
  var { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .not('company_id', 'is', null)
    .not('ahj_id', 'is', null)
    .not('parcel_number', 'is', null)
    .not('legal_description', 'is', null)
    .eq('noc_status', 'not_started')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('SUPABASE ERROR:', JSON.stringify(error, null, 2))
    throw new Error('Failed to query for usable jobs')
  }

  if (!jobs || jobs.length === 0) return null
  return jobs[0]
}

async function loadJobById(supabase, jobId) {
  var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (error) {
    console.error('SUPABASE ERROR:', JSON.stringify(error, null, 2))
    throw new Error('Failed to load job: ' + jobId)
  }
  return job
}

async function verifyApiReturnsJson(jobId) {
  console.log('\n--- API smoke test (JSON response) ---')
  console.log('App base URL: ' + getAppBaseUrl())

  try {
    var apiResult = await callNocStartApi(jobId, { baseUrl: getAppBaseUrl() })
    if (typeof apiResult !== 'object' || apiResult === null) {
      throw new Error('API did not return a JSON object')
    }
    console.log('✓ /api/noc/start returned JSON')
    if (apiResult.error) {
      console.log('  API error field: ' + apiResult.error)
    } else if (apiResult.success) {
      console.log('  API success: jobId=' + apiResult.jobId)
    }
    return apiResult
  } catch (err) {
    if (err.message && err.message.indexOf('fetch failed') !== -1) {
      console.log('⚠ Dev server not reachable at ' + getAppBaseUrl() + ' — skipping live API test')
      console.log('  (Direct trigger test below is the primary path for automation)')
      return null
    }
    throw err
  }
}

async function main() {
  var args = parseArgs(process.argv.slice(2))
  var supabase = getSupabase()
  var job = null
  var source = null

  console.log('NOC trigger after Phase 1 test')

  if (args.jobId) {
    source = process.env.JOB_ID ? 'JOB_ID env' : 'CLI argument'
    job = await loadJobById(supabase, args.jobId)
  } else {
    console.log('No JOB_ID provided — searching for newest usable job...')
    console.log('  criteria: company_id, ahj_id, parcel_number, legal_description set; noc_status = not_started')
    job = await findNewestUsableJob(supabase)
    source = 'auto-selected'
  }

  if (!job) {
    console.log('\nNo usable job found for NOC trigger test.')
    console.log('Provide a job explicitly:')
    console.log('  JOB_ID=<uuid> node automation/test-noc-trigger-after-phase1.js')
    console.log('Or ensure a job exists with company_id, ahj_id, parcel_number, legal_description, and noc_status = not_started.')
    process.exit(0)
  }

  printJobSummary(job, source)

  if (!hasRequiredNocFields(job)) {
    console.error('\nCannot start NOC chain — job is missing parcel_number or legal_description.')
    process.exit(1)
  }

  if (args.testApi) {
    await verifyApiReturnsJson(job.id)
  }

  console.log('\n--- Direct server trigger (automation path) ---')
  var result = await triggerNocAfterPhase1Direct(job.id, {
    waitForProofCompletion: false,
  })

  if (typeof result !== 'object' || result === null) {
    throw new Error('Direct trigger did not return an object')
  }
  console.log('✓ Direct trigger returned JSON-serializable result')
  console.log('  stoppingPoint: ' + (result.stoppingPoint || 'unknown'))

  var { data: updated, error: reloadError } = await supabase
    .from('jobs')
    .select('noc_status, noc_file_path, job_status')
    .eq('id', job.id)
    .single()

  if (reloadError) {
    console.error('SUPABASE ERROR:', JSON.stringify(reloadError, null, 2))
    throw new Error('Failed to reload job after NOC trigger')
  }
  if (!updated) throw new Error('Failed to reload job after NOC trigger')

  if (!updated.noc_file_path || !String(updated.noc_file_path).trim()) {
    throw new Error('noc_file_path not saved after NOC trigger')
  }

  console.log('✓ noc_file_path saved: ' + updated.noc_file_path)
  console.log('✓ noc_status: ' + updated.noc_status)
  console.log('✓ job_status: ' + updated.job_status)
  console.log('\nAll checks passed — no HTML/JSON parse errors')
}

main().catch(function(err) {
  console.error('\nTest failed: ' + err.message)
  if (err.bodyPreview) {
    console.error('Response preview: ' + err.bodyPreview)
  }
  process.exit(1)
})
