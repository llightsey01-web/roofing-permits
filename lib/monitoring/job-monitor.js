// lib/monitoring/job-monitor.js
// Queries for stuck jobs, failed runs, and stale workers

const { createClient } = require('@supabase/supabase-js')
const { sendAlert } = require('./alert-service')
const { getWorkerHeartbeatStatus } = require('./worker-heartbeat')

const STUCK_JOB_HOURS = 2
const FAILED_RUNS_LOOKBACK_HOURS = 1
const WORKER_STALE_MINUTES = 10

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function countStuckAutomationJobs() {
  var supabase = getSupabase()
  if (!supabase) return { count: 0, jobs: [], error: 'supabase_unconfigured' }

  var cutoff = new Date(Date.now() - STUCK_JOB_HOURS * 60 * 60 * 1000).toISOString()
  var { data, error } = await supabase
    .from('jobs')
    .select('id, company_id, property_address, job_status, updated_at')
    .eq('job_status', 'automation_running')
    .lt('updated_at', cutoff)

  if (error) return { count: 0, jobs: [], error: error.message }
  return { count: (data || []).length, jobs: data || [], cutoff: cutoff }
}

async function countFailedRunsLastHour() {
  var supabase = getSupabase()
  if (!supabase) return { count: 0, runs: [], error: 'supabase_unconfigured' }

  var cutoff = new Date(Date.now() - FAILED_RUNS_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
  var { data, error } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_type, error_message, attempts, completed_at')
    .eq('run_status', 'error')
    .gte('completed_at', cutoff)
    .order('completed_at', { ascending: false })

  if (error) return { count: 0, runs: [], error: error.message }
  return { count: (data || []).length, runs: data || [], cutoff: cutoff }
}

async function getLastSuccessfulRunAt() {
  var supabase = getSupabase()
  if (!supabase) return null

  var { data, error } = await supabase
    .from('automation_runs')
    .select('completed_at')
    .in('run_status', ['complete', 'needs_review'])
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.completed_at
}

async function checkDatabaseConnectivity() {
  var supabase = getSupabase()
  if (!supabase) return false
  var { error } = await supabase.from('jobs').select('id').limit(1)
  return !error
}

async function checkStuckJobsAndAlert(options) {
  var opts = options || {}
  var result = await countStuckAutomationJobs()
  if (result.count > 0 && opts.sendAlerts !== false) {
    for (var i = 0; i < result.jobs.length; i++) {
      var job = result.jobs[i]
      await sendAlert({
        type: 'stuck_job',
        severity: 'warning',
        jobId: job.id,
        companyId: job.company_id,
        message: 'Job stuck in automation_running for more than ' + STUCK_JOB_HOURS + ' hours',
        details: {
          property_address: job.property_address,
          updated_at: job.updated_at,
          cutoff: result.cutoff,
        },
      })
    }
  }
  return result
}

async function checkFailedRunsAndAlert(options) {
  var opts = options || {}
  var result = await countFailedRunsLastHour()
  if (result.count > 0 && opts.sendAlerts !== false) {
    await sendAlert({
      type: 'automation_failed',
      severity: 'warning',
      message: result.count + ' automation run(s) failed in the last hour',
      details: {
        runIds: (result.runs || []).slice(0, 10).map(function(r) { return r.id }),
        cutoff: result.cutoff,
      },
    })
  }
  return result
}

async function checkStaleWorkersAndAlert(options) {
  var opts = options || {}
  var hb = await getWorkerHeartbeatStatus(WORKER_STALE_MINUTES)
  if (!hb.heartbeatsAvailable) {
    return { ...hb, stale: [] }
  }

  var stale = []
  if (!hb.workers.permit) stale.push('permit')
  if (!hb.workers.nocProof) stale.push('nocProof')
  if (!hb.workers.ops) stale.push('ops')

  if (stale.length > 0 && opts.sendAlerts !== false) {
    await sendAlert({
      type: 'worker_stale',
      severity: 'critical',
      message: 'Worker(s) have not polled in ' + WORKER_STALE_MINUTES + ' minutes: ' + stale.join(', '),
      details: { staleWorkers: stale, cutoff: hb.cutoff },
    })
  }

  return { workers: hb.workers, heartbeatsAvailable: true, stale: stale }
}

async function getSystemHealthSnapshot(options) {
  var opts = options || {}
  var sendAlerts = opts.sendAlerts === true

  var database = await checkDatabaseConnectivity()
  var stuck = sendAlerts
    ? await checkStuckJobsAndAlert({ sendAlerts: true })
    : await countStuckAutomationJobs()
  var failed = sendAlerts
    ? await checkFailedRunsAndAlert({ sendAlerts: true })
    : await countFailedRunsLastHour()
  var workerHb = sendAlerts
    ? await checkStaleWorkersAndAlert({ sendAlerts: true })
    : await getWorkerHeartbeatStatus(WORKER_STALE_MINUTES)

  var lastRunAt = await getLastSuccessfulRunAt()
  var workers = workerHb.workers || { permit: false, nocProof: false, ops: false }

  var status = 'ok'
  if (!database) {
    status = 'down'
  } else if (
    stuck.count > 0 ||
    failed.count > 0 ||
    (workerHb.stale && workerHb.stale.length > 0)
  ) {
    status = 'degraded'
  }

  return {
    status: status,
    workers: workers,
    database: database,
    lastRunAt: lastRunAt,
    stuckJobs: stuck.count,
    failedRunsLastHour: failed.count,
    heartbeatsAvailable: workerHb.heartbeatsAvailable !== false,
    staleWorkers: workerHb.stale || [],
    checkedAt: new Date().toISOString(),
  }
}

async function runScheduledMonitors() {
  return getSystemHealthSnapshot({ sendAlerts: true })
}

module.exports = {
  STUCK_JOB_HOURS,
  FAILED_RUNS_LOOKBACK_HOURS,
  WORKER_STALE_MINUTES,
  countStuckAutomationJobs,
  countFailedRunsLastHour,
  getSystemHealthSnapshot,
  runScheduledMonitors,
  checkStuckJobsAndAlert,
  checkFailedRunsAndAlert,
  checkStaleWorkersAndAlert,
}
