require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')
const {
  triggerNocAfterPhase1Direct,
  callNocStartApi,
} = require('../lib/automation/noc-trigger')
const { getAppBaseUrl } = require('../lib/app-base-url')

const DEFAULT_JOB_ID = '488bda23-95e3-469c-9c94-0bd4260afbf0'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function parseArgs(argv) {
  var jobId = null
  var testApi = false
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--test-api') testApi = true
    else if (!argv[i].startsWith('--') && !jobId) jobId = argv[i]
  }
  return { jobId: jobId || DEFAULT_JOB_ID, testApi: testApi }
}

async function assertPhase1Ready(job) {
  var missing = []
  if (!job.parcel_number || !String(job.parcel_number).trim()) missing.push('parcel_number')
  if (!job.portal_confirmation || !String(job.portal_confirmation).trim()) missing.push('portal_confirmation')
  if (!job.legal_description || !String(job.legal_description).trim()) missing.push('legal_description')
  if (missing.length) {
    throw new Error('Job missing Phase 1 fields: ' + missing.join(', '))
  }
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
  var jobId = args.jobId
  var supabase = getSupabase()

  console.log('NOC trigger after Phase 1 test')
  console.log('Job ID: ' + jobId)

  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  await assertPhase1Ready(job)
  console.log('✓ Phase 1 fields present')
  console.log('  parcel_number: ' + job.parcel_number)
  console.log('  portal_confirmation: ' + (job.portal_confirmation ? 'yes' : 'no'))

  if (args.testApi) {
    await verifyApiReturnsJson(jobId)
  }

  console.log('\n--- Direct server trigger (automation path) ---')
  var result = await triggerNocAfterPhase1Direct(jobId, {
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
    .eq('id', jobId)
    .single()

  if (reloadError || !updated) throw new Error('Failed to reload job after NOC trigger')

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
