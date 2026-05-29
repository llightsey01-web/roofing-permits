// worker/index.js
require('dotenv').config({ path: '../.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const POLL_INTERVAL_MS = 30000

async function claimAndRun() {
  console.log('[worker] Polling for queued runs...')
  const { data: run, error } = await supabase
    .from('automation_runs')
    .select('*, jobs(*)')
    .eq('run_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  if (error || !run) {
    console.log('[worker] No queued runs found')
    return
  }
  console.log('[worker] Claiming run:', run.id, 'for job:', run.job_id)
  const { error: claimError } = await supabase
    .from('automation_runs')
    .update({ run_status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('run_status', 'queued')
  if (claimError) {
    console.log('[worker] Failed to claim run — already claimed')
    return
  }
  const { data: job } = await supabase.from('jobs').select('*').eq('id', run.job_id).single()
  const { data: documents } = await supabase.from('job_documents').select('*').eq('job_id', run.job_id)
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
poll()
