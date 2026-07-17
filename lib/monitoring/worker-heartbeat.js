// lib/monitoring/worker-heartbeat.js
// Worker poll heartbeats for stale-worker detection + daily uptime estimates

const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const WORKER_NAMES = ['permit', 'nocProof', 'ops']
const DEFAULT_INTERVAL_MS = 30000
const STALE_MS = 10 * 60 * 1000

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

async function recordWorkerPoll(workerName, metadata) {
  var supabase = getSupabase()
  if (!supabase) return { ok: false }

  var nowIso = new Date().toISOString()
  var day = todayKey()
  var extra = metadata && typeof metadata === 'object' ? metadata : {}

  var { data: existing } = await supabase
    .from('worker_heartbeats')
    .select('last_poll_at, metadata')
    .eq('worker_name', workerName)
    .maybeSingle()

  var prevMeta = existing && existing.metadata && typeof existing.metadata === 'object'
    ? existing.metadata
    : {}
  var wasFresh = existing && existing.last_poll_at
    ? (Date.now() - new Date(existing.last_poll_at).getTime()) < STALE_MS
    : false
  var pollCount = prevMeta.day_key === day ? (Number(prevMeta.poll_count) || 0) + 1 : 1
  var upSince = wasFresh && prevMeta.up_since ? prevMeta.up_since : nowIso

  var nextMeta = Object.assign({}, prevMeta, extra, {
    day_key: day,
    poll_count: pollCount,
    up_since: upSince,
    expected_interval_ms: Number(extra.expected_interval_ms) || Number(prevMeta.expected_interval_ms) || DEFAULT_INTERVAL_MS,
  })

  var { error } = await supabase.from('worker_heartbeats').upsert({
    worker_name: workerName,
    last_poll_at: nowIso,
    metadata: nextMeta,
  }, { onConflict: 'worker_name' })

  if (error) {
    console.warn('[heartbeat] Failed to record poll for ' + workerName + ':', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, poll_count: pollCount }
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
  rows.forEach(function (row) {
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
