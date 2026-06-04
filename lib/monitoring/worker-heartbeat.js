// lib/monitoring/worker-heartbeat.js
// Worker poll heartbeats for stale-worker detection

const { createClient } = require('@supabase/supabase-js')

const WORKER_NAMES = ['permit', 'nocProof', 'ops']

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function recordWorkerPoll(workerName, metadata) {
  var supabase = getSupabase()
  if (!supabase) return { ok: false }

  var { error } = await supabase.from('worker_heartbeats').upsert({
    worker_name: workerName,
    last_poll_at: new Date().toISOString(),
    metadata: metadata || {},
  }, { onConflict: 'worker_name' })

  if (error) {
    console.warn('[heartbeat] Failed to record poll for ' + workerName + ':', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

async function getWorkerHeartbeatStatus(staleMinutes) {
  var thresholdMs = (staleMinutes || 10) * 60 * 1000
  var cutoff = new Date(Date.now() - thresholdMs).toISOString()
  var supabase = getSupabase()

  var status = {
    permit: false,
    nocProof: false,
    ops: false,
  }

  if (!supabase) {
    return { workers: status, heartbeatsAvailable: false }
  }

  var { data, error } = await supabase
    .from('worker_heartbeats')
    .select('worker_name, last_poll_at')

  if (error) {
    return { workers: status, heartbeatsAvailable: false, error: error.message }
  }

  var rows = data || []
  rows.forEach(function(row) {
    if (row.last_poll_at && row.last_poll_at >= cutoff) {
      if (row.worker_name === 'permit') status.permit = true
      if (row.worker_name === 'nocProof') status.nocProof = true
      if (row.worker_name === 'ops') status.ops = true
    }
  })

  return { workers: status, heartbeatsAvailable: true, cutoff: cutoff }
}

module.exports = {
  WORKER_NAMES,
  recordWorkerPoll,
  getWorkerHeartbeatStatus,
}
