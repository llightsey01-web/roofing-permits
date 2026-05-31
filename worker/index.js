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

async function claimAndRun() {
  console.log('[worker] Polling for queued runs...')

  const { data: runs, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_status')
    .eq('run_status', 'queued')
    .order('started_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[worker] Query error:', error.message)
    return
  }

  if (!runs || runs.length === 0) {
    console.log('[worker] No queued runs found')
    return
  }

  const run = runs[0]
  console.log('[worker] Found queued run:', run.id, 'job:', run.job_id)

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
  await executeRun(jobWithDocs, run.id)
}

async function poll() {
  try {
    await claimAndRun()
  } catch (err) {
    console.error('[worker] Poll error:', err.message)
  }
  setTimeout(poll, POLL_INTERVAL_MS)
}

console.log('[worker] Starting AHJ-iQ automation worker')
console.log('[worker] Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING')
console.log('[worker] Service key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
poll()