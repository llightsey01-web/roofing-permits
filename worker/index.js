// worker/index.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const POLL_INTERVAL_MS = 30000
const PROOF_POLL_INTERVAL_MS = 30 * 60 * 1000
const PROOF_POLL_START_DELAY_MS = 5 * 60 * 1000

const PERMIT_RUN_TYPE_FILTER = 'run_type.in.(permit_phase_1,permit_resume,permit_submit),run_type.is.null'

async function claimAndRun() {
  console.log('[worker] Polling for queued permit portal runs...')

  const { data: runs, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_status, run_type, payload, dependency_run_id, attempts')
    .eq('run_status', 'queued')
    .or(PERMIT_RUN_TYPE_FILTER)
    .order('started_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[worker] Query error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    console.log('[worker] No queued permit runs found')
    return
  }

  const run = runs[0]
  console.log('[worker] Found queued run:', run.id, 'job:', run.job_id, 'run_type:', run.run_type || '(null)')

  const { error: claimError } = await supabase
    .from('automation_runs')
    .update({ run_status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('run_status', 'queued')

  if (claimError) {
    console.error('[worker] Claim error:', claimError.message)
    return
  }

  console.log('[worker] Claimed run:', run.id)

  const { data: job, error: jobError } = await supabase
    .from('jobs').select('*').eq('id', run.job_id).single()

  if (jobError || !job) {
    console.error('[worker] Job not found:', run.job_id)
    return
  }

  const { data: documents } = await supabase
    .from('job_documents').select('*').eq('job_id', run.job_id)

  const jobWithDocs = { ...job, documents: documents || [] }

  const { executeRun } = require('./runner')
  await executeRun(jobWithDocs, run)
}

async function poll() {
  try {
    await claimAndRun()
  } catch (err) {
    console.error('[worker] Poll error:', err.message)
  }
  setTimeout(poll, POLL_INTERVAL_MS)
}

async function pollProofCompletions() {
  try {
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, owner_name, property_address, job_specs, noc_status')
      .eq('noc_status', 'sent_to_homeowner')

    if (error) {
      console.error('[proof-poller] Query error:', error.message)
      return
    }

    if (!jobs || jobs.length === 0) {
      console.log('[proof-poller] No jobs waiting for Proof completion')
      return
    }

    console.log('[proof-poller] Checking ' + jobs.length + ' job(s) for Proof completion...')

    const { runProofCompletionCheck } = require('../lib/proof/completion.js')

    for (const job of jobs) {
      try {
        console.log('[proof-poller] Checking job ' + job.id + ' (' + job.property_address + ')...')

        const result = await runProofCompletionCheck({ jobId: job.id, headless: true })
        const jobResult = (result.results || [])[0]

        if (jobResult && jobResult.complete) {
          console.log('[proof-poller] ✓ Job ' + job.id + ' notarized — triggering ePN')
          await supabase.from('jobs')
            .update({ noc_status: 'queued_for_erecord' })
            .eq('id', job.id)
        } else {
          console.log('[proof-poller] Job ' + job.id + ' not yet complete')
        }
      } catch (jobErr) {
        console.error('[proof-poller] Error checking job ' + job.id + ':', jobErr.message)
      }
    }
  } catch (err) {
    console.error('[proof-poller] Poll error:', err.message)
  }

  setTimeout(pollProofCompletions, PROOF_POLL_INTERVAL_MS)
}

console.log('[worker] Starting AHJ-iQ permit portal worker (Worker 1)')
console.log('[worker] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING')
console.log('[worker] Service key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
poll()
setTimeout(pollProofCompletions, PROOF_POLL_START_DELAY_MS)
