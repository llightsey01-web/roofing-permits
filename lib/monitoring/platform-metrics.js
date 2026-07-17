'use strict'

/**
 * Platform metrics: live system dashboard aggregates + daily upserts for ops-worker.
 */

const POLL_INTERVAL_MS = 30000
const STALE_MS = 10 * 60 * 1000
const SUCCESS_STATUSES = ['complete', 'needs_review']

const RUN_TYPE_GROUPS = [
  { key: 'noc_generate', label: 'NOC Generation', types: ['noc_generate'] },
  { key: 'proof', label: 'Proof.com', types: ['proof_send', 'proof_check'] },
  { key: 'erecord', label: 'ePN Recording', types: ['erecord_prepare', 'erecord_submit'] },
  { key: 'permit_portal', label: 'Permit Portal', types: ['permit_phase_1', 'permit_resume', 'permit_submit'] },
  { key: 'ops', label: 'Ops / Notify', types: ['notify_admin', 'build_packet', 'status_reconcile'] },
]

function isSuccessStatus(status) {
  return SUCCESS_STATUSES.indexOf(status) !== -1
}

function startOfUtcDay(d) {
  const x = d ? new Date(d) : new Date()
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()))
}

function metricDateString(d) {
  return startOfUtcDay(d).toISOString().slice(0, 10)
}

function msToMinutes(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  return Math.round((ms / 60000) * 10) / 10
}

function avg(nums) {
  if (!nums || !nums.length) return null
  var sum = 0
  for (var i = 0; i < nums.length; i++) sum += nums[i]
  return sum / nums.length
}

function uptimeColor(pct) {
  if (pct == null) return 'unknown'
  if (pct > 99) return 'green'
  if (pct >= 95) return 'yellow'
  return 'red'
}

function computeWorkerUptime(heartbeat) {
  if (!heartbeat || !heartbeat.last_poll_at) {
    return { percent: 0, fresh: false, color: 'red', poll_count: 0, expected: 0 }
  }

  var last = new Date(heartbeat.last_poll_at).getTime()
  var fresh = Date.now() - last < STALE_MS
  var meta = heartbeat.metadata && typeof heartbeat.metadata === 'object' ? heartbeat.metadata : {}
  var today = metricDateString(new Date())
  var pollCount = meta.day_key === today ? Number(meta.poll_count) || 0 : 0
  var interval = Number(meta.expected_interval_ms) || POLL_INTERVAL_MS

  var dayStart = startOfUtcDay(new Date()).getTime()
  var elapsed = Math.max(interval, Date.now() - dayStart)
  var expected = Math.max(1, Math.floor(elapsed / interval))
  var percent = Math.min(100, Math.round((pollCount / expected) * 1000) / 10)

  // If we have almost no poll history yet today, fall back to freshness signal
  if (pollCount < 3) {
    percent = fresh ? 99.5 : 0
  }
  if (!fresh) {
    percent = Math.min(percent, 90)
  }

  return {
    percent: percent,
    fresh: fresh,
    color: uptimeColor(percent),
    poll_count: pollCount,
    expected: expected,
    last_poll_at: heartbeat.last_poll_at,
  }
}

function durationMs(run) {
  if (!run.started_at || !run.completed_at) return null
  var ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
  return ms >= 0 ? ms : null
}

function groupForRunType(runType) {
  var t = runType || 'permit_phase_1'
  for (var i = 0; i < RUN_TYPE_GROUPS.length; i++) {
    if (RUN_TYPE_GROUPS[i].types.indexOf(t) !== -1) return RUN_TYPE_GROUPS[i]
  }
  return { key: t, label: t, types: [t] }
}

function rateRow(label, key, success, total) {
  var pct = total > 0 ? Math.round((success / total) * 1000) / 10 : null
  return {
    key: key,
    label: label,
    success: success,
    total: total,
    percent: pct,
    warn: pct != null && pct < 80,
  }
}

/**
 * Live dashboard payload for GET /api/admin/system-metrics
 */
async function computeSystemMetrics(supabase) {
  var now = new Date()
  var day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  var day1 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  var today = metricDateString(now)

  var [
    heartbeatsRes,
    runs30Res,
    queueQueuedRes,
    queueRunningRes,
    failed24Res,
    jobsTodayRes,
    metricsRes,
  ] = await Promise.all([
    supabase.from('worker_heartbeats').select('worker_name, last_poll_at, metadata').order('worker_name'),
    supabase
      .from('automation_runs')
      .select('id, job_id, run_type, run_status, error_message, started_at, completed_at')
      .gte('started_at', day30)
      .limit(5000),
    supabase.from('automation_runs').select('id', { count: 'exact', head: true }).eq('run_status', 'queued'),
    supabase.from('automation_runs').select('id', { count: 'exact', head: true }).eq('run_status', 'running'),
    supabase
      .from('automation_runs')
      .select('id', { count: 'exact', head: true })
      .eq('run_status', 'error')
      .gte('completed_at', day1),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfUtcDay(now).toISOString()),
    supabase
      .from('platform_metrics')
      .select('metric_name, metric_value, metric_date, metadata')
      .gte('metric_date', metricDateString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)))
      .order('metric_date', { ascending: false })
      .limit(200),
  ])

  var heartbeats = heartbeatsRes.data || []
  var runs30 = runs30Res.data || []
  var storedMetrics = metricsRes.data || []

  var hbByName = {}
  heartbeats.forEach(function (h) { hbByName[h.worker_name] = h })

  var workerNames = ['permit', 'nocProof', 'ops']
  var workers = workerNames.map(function (name) {
    var up = computeWorkerUptime(hbByName[name] || null)
    return {
      worker_name: name,
      ...up,
    }
  })

  // App uptime: prefer stored daily metrics; else healthy if we reached here
  var appUptimeRows = storedMetrics.filter(function (m) { return m.metric_name === 'app_uptime' })
  var appUptimeAvg = avg(appUptimeRows.map(function (m) { return Number(m.metric_value) }).filter(function (n) { return Number.isFinite(n) }))
  var appUptime = appUptimeAvg != null ? Math.round(appUptimeAvg * 10) / 10 : 99.9

  // Performance averages by group (runs with both timestamps)
  var durationBuckets = {}
  RUN_TYPE_GROUPS.forEach(function (g) { durationBuckets[g.key] = [] })
  durationBuckets.permit_completion = []

  runs30.forEach(function (run) {
    var ms = durationMs(run)
    if (ms == null) return
    var g = groupForRunType(run.run_type)
    if (!durationBuckets[g.key]) durationBuckets[g.key] = []
    durationBuckets[g.key].push(ms)
    if (g.key === 'permit_portal' && isSuccessStatus(run.run_status)) {
      durationBuckets.permit_completion.push(ms)
    }
  })

  var performance = {
    avg_permit_completion_minutes: msToMinutes(avg(durationBuckets.permit_completion)),
    avg_noc_generation_minutes: msToMinutes(avg(durationBuckets.noc_generate)),
    avg_proof_minutes: msToMinutes(avg(durationBuckets.proof)),
    avg_erecord_minutes: msToMinutes(avg(durationBuckets.erecord)),
  }

  // Success rates last 30 days by group
  var groupStats = {}
  RUN_TYPE_GROUPS.forEach(function (g) {
    groupStats[g.key] = { label: g.label, success: 0, total: 0 }
  })

  var captchaTotal = 0
  var captchaFail = 0
  var overallSuccess = 0
  var overallTotal = 0

  runs30.forEach(function (run) {
    var finished = run.run_status === 'error' || isSuccessStatus(run.run_status)
    if (!finished) return
    overallTotal += 1
    if (isSuccessStatus(run.run_status)) overallSuccess += 1

    var g = groupForRunType(run.run_type)
    if (!groupStats[g.key]) groupStats[g.key] = { label: g.label, success: 0, total: 0 }
    groupStats[g.key].total += 1
    if (isSuccessStatus(run.run_status)) groupStats[g.key].success += 1

    var err = (run.error_message || '').toLowerCase()
    if (err.indexOf('captcha') !== -1 || (run.run_type || '').indexOf('captcha') !== -1) {
      captchaTotal += 1
      if (run.run_status === 'error') captchaFail += 1
    }
  })

  // AHJ-specific rates via job join
  var jobIds = []
  var jobIdSet = {}
  runs30.forEach(function (r) {
    if (!r.job_id || jobIdSet[r.job_id]) return
    jobIdSet[r.job_id] = true
    jobIds.push(r.job_id)
  })

  var jobsById = {}
  var portalsById = {}
  if (jobIds.length > 0) {
    var chunk = jobIds.slice(0, 1000)
    var { data: jobs } = await supabase
      .from('jobs')
      .select('id, ahj_id, property_city')
      .in('id', chunk)
    ;(jobs || []).forEach(function (j) { jobsById[j.id] = j })

    var ahjIds = []
    var ahjSet = {}
    ;(jobs || []).forEach(function (j) {
      if (j.ahj_id && !ahjSet[j.ahj_id]) {
        ahjSet[j.ahj_id] = true
        ahjIds.push(j.ahj_id)
      }
    })
    if (ahjIds.length > 0) {
      var { data: portals } = await supabase
        .from('ahj_portals')
        .select('id, name, county_or_city')
        .in('id', ahjIds)
      ;(portals || []).forEach(function (p) { portalsById[p.id] = p })
    }
  }

  function countyKeyForJob(job) {
    if (!job) return null
    var portal = job.ahj_id ? portalsById[job.ahj_id] : null
    var hay = (
      (portal && (portal.name || '') + ' ' + (portal.county_or_city || '')) +
      ' ' + (job.property_city || '')
    ).toLowerCase()
    if (hay.indexOf('polk') !== -1) return 'polk'
    if (hay.indexOf('lee') !== -1) return 'lee'
    if (hay.indexOf('manatee') !== -1) return 'manatee'
    if (hay.indexOf('sarasota') !== -1) return 'sarasota'
    return null
  }

  var countyStats = {
    polk: { label: 'Polk County Portal', success: 0, total: 0 },
    lee: { label: 'Lee County Portal', success: 0, total: 0 },
  }

  runs30.forEach(function (run) {
    var g = groupForRunType(run.run_type)
    if (g.key !== 'permit_portal') return
    var finished = run.run_status === 'error' || isSuccessStatus(run.run_status)
    if (!finished) return
    var county = countyKeyForJob(jobsById[run.job_id])
    if (!county || !countyStats[county]) return
    countyStats[county].total += 1
    if (isSuccessStatus(run.run_status)) countyStats[county].success += 1
  })

  var successRates = []
  RUN_TYPE_GROUPS.forEach(function (g) {
    var s = groupStats[g.key]
    successRates.push(rateRow(g.label, g.key, s.success, s.total))
  })
  Object.keys(countyStats).forEach(function (k) {
    var s = countyStats[k]
    if (s.total > 0) successRates.push(rateRow(s.label, k + '_portal', s.success, s.total))
  })
  var captchaSuccess = Math.max(0, captchaTotal - captchaFail)
  if (captchaTotal > 0) {
    successRates.push(rateRow('CAPTCHA Solving', 'captcha', captchaSuccess, captchaTotal))
  }

  var overallPct = overallTotal > 0 ? Math.round((overallSuccess / overallTotal) * 1000) / 10 : null

  // Queued by type bucket
  var queuedByType = { permit: 0, noc_proof: 0, ops: 0, other: 0 }
  var { data: queuedRows } = await supabase
    .from('automation_runs')
    .select('id, run_type')
    .eq('run_status', 'queued')
    .limit(500)

  ;(queuedRows || []).forEach(function (r) {
    var g = groupForRunType(r.run_type)
    if (g.key === 'permit_portal') queuedByType.permit += 1
    else if (g.key === 'noc_generate' || g.key === 'proof' || g.key === 'erecord') queuedByType.noc_proof += 1
    else if (g.key === 'ops') queuedByType.ops += 1
    else queuedByType.other += 1
  })

  return {
    checked_at: now.toISOString(),
    metric_date: today,
    uptime: {
      workers: workers,
      app: {
        percent: appUptime,
        color: uptimeColor(appUptime),
        source: appUptimeRows.length ? 'platform_metrics' : 'estimated',
      },
    },
    performance: performance,
    success_rates: {
      window_days: 30,
      rows: successRates,
      overall: {
        percent: overallPct,
        success: overallSuccess,
        total: overallTotal,
      },
    },
    queues: {
      queued: queueQueuedRes.count || 0,
      running: queueRunningRes.count || 0,
      failed_last_24h: failed24Res.count || 0,
      by_type: queuedByType,
      jobs_submitted_today: jobsTodayRes.count || 0,
    },
    recent_metrics: storedMetrics.slice(0, 40),
  }
}

/**
 * Compute + upsert daily platform_metrics rows (idempotent per metric_name + date).
 */
async function upsertDailyPlatformMetrics(supabase, options) {
  var opts = options || {}
  var forDate = opts.date ? new Date(opts.date) : new Date()
  // For midnight job: store metrics for the day that just ended (UTC yesterday) if hour is 0,
  // otherwise store for "today so far". Callers can pass date explicitly.
  var dateStr = metricDateString(forDate)
  var dayStart = startOfUtcDay(forDate).toISOString()
  var dayEnd = new Date(startOfUtcDay(forDate).getTime() + 24 * 60 * 60 * 1000).toISOString()

  var { data: runs, error: runsError } = await supabase
    .from('automation_runs')
    .select('id, job_id, run_type, run_status, error_message, started_at, completed_at')
    .gte('started_at', dayStart)
    .lt('started_at', dayEnd)
    .limit(5000)

  if (runsError) throw new Error('Failed to load runs for metrics: ' + runsError.message)

  var runList = runs || []
  var { count: jobsSubmitted } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)

  var success = 0
  var total = 0
  var captchaFail = 0
  var captchaTotal = 0
  var byType = {}
  var durations = { noc_generate: [], proof: [], erecord: [], permit_portal: [] }

  runList.forEach(function (run) {
    var finished = run.run_status === 'error' || isSuccessStatus(run.run_status)
    if (finished) {
      total += 1
      if (isSuccessStatus(run.run_status)) success += 1
      var g = groupForRunType(run.run_type)
      if (!byType[g.key]) byType[g.key] = { success: 0, total: 0, label: g.label }
      byType[g.key].total += 1
      if (isSuccessStatus(run.run_status)) byType[g.key].success += 1
    }

    var err = (run.error_message || '').toLowerCase()
    if (err.indexOf('captcha') !== -1) {
      captchaTotal += 1
      if (run.run_status === 'error') captchaFail += 1
    }

    var ms = durationMs(run)
    if (ms != null) {
      var gg = groupForRunType(run.run_type)
      if (durations[gg.key]) durations[gg.key].push(ms)
    }
  })

  var { data: heartbeats } = await supabase
    .from('worker_heartbeats')
    .select('worker_name, last_poll_at, metadata')

  var workerUptime = {}
  ;(heartbeats || []).forEach(function (h) {
    workerUptime[h.worker_name] = computeWorkerUptime(h).percent
  })

  var rows = [
    {
      metric_name: 'jobs_submitted',
      metric_value: jobsSubmitted || 0,
      metric_date: dateStr,
      metadata: {},
    },
    {
      metric_name: 'automation_success_rate',
      metric_value: total > 0 ? Math.round((success / total) * 1000) / 10 : 0,
      metric_date: dateStr,
      metadata: { success: success, total: total },
    },
    {
      metric_name: 'captcha_failure_rate',
      metric_value: captchaTotal > 0 ? Math.round((captchaFail / captchaTotal) * 1000) / 10 : 0,
      metric_date: dateStr,
      metadata: { failures: captchaFail, total: captchaTotal },
    },
    {
      metric_name: 'avg_noc_generation_minutes',
      metric_value: msToMinutes(avg(durations.noc_generate)) || 0,
      metric_date: dateStr,
      metadata: { samples: durations.noc_generate.length },
    },
    {
      metric_name: 'avg_proof_minutes',
      metric_value: msToMinutes(avg(durations.proof)) || 0,
      metric_date: dateStr,
      metadata: { samples: durations.proof.length },
    },
    {
      metric_name: 'avg_erecord_minutes',
      metric_value: msToMinutes(avg(durations.erecord)) || 0,
      metric_date: dateStr,
      metadata: { samples: durations.erecord.length },
    },
    {
      metric_name: 'avg_permit_minutes',
      metric_value: msToMinutes(avg(durations.permit_portal)) || 0,
      metric_date: dateStr,
      metadata: { samples: durations.permit_portal.length },
    },
    {
      metric_name: 'app_uptime',
      metric_value: 100,
      metric_date: dateStr,
      metadata: { source: 'ops-worker daily snapshot', note: 'Process reachable + DB query succeeded' },
    },
    {
      metric_name: 'success_rate_by_run_type',
      metric_value: total > 0 ? Math.round((success / total) * 1000) / 10 : 0,
      metric_date: dateStr,
      metadata: { by_type: byType },
    },
  ]

  Object.keys(workerUptime).forEach(function (name) {
    rows.push({
      metric_name: 'worker_uptime_' + name,
      metric_value: workerUptime[name],
      metric_date: dateStr,
      metadata: {},
    })
  })

  var written = 0
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    var { error } = await supabase
      .from('platform_metrics')
      .upsert(row, { onConflict: 'metric_name,metric_date' })
    if (error) {
      // Fallback if upsert conflict target unsupported: delete+insert
      await supabase
        .from('platform_metrics')
        .delete()
        .eq('metric_name', row.metric_name)
        .eq('metric_date', row.metric_date)
      var { error: insertError } = await supabase.from('platform_metrics').insert(row)
      if (insertError) {
        console.warn('[platform-metrics] Failed to write', row.metric_name, insertError.message)
        continue
      }
    }
    written += 1
  }

  return { date: dateStr, written: written, rows: rows }
}

/**
 * Run daily metrics at most once per UTC calendar day (tracked in-memory + DB).
 */
function createDailyMetricsScheduler(supabase, options) {
  var opts = options || {}
  var lastRunDate = null
  var running = false

  async function maybeRunDailyMetrics() {
    var now = new Date()
    var today = metricDateString(now)
    var hourUtc = now.getUTCHours()
    var forceHour = opts.forceHourUtc != null ? opts.forceHourUtc : 0

    // Run in the midnight UTC hour, or if never run today and past midnight
    if (hourUtc !== forceHour && !opts.force) {
      // Allow catch-up later in the day if midnight poll was missed
      if (lastRunDate === today) return { skipped: true, reason: 'already_ran_in_memory' }
      if (hourUtc < forceHour) return { skipped: true, reason: 'before_window' }
    }

    if (lastRunDate === today && !opts.force) {
      return { skipped: true, reason: 'already_ran_in_memory' }
    }
    if (running) return { skipped: true, reason: 'in_progress' }

    // Check DB for existing daily marker
    var { data: existing } = await supabase
      .from('platform_metrics')
      .select('id')
      .eq('metric_name', 'jobs_submitted')
      .eq('metric_date', today)
      .maybeSingle()

    if (existing && !opts.force) {
      lastRunDate = today
      return { skipped: true, reason: 'already_in_db', date: today }
    }

    running = true
    try {
      var result = await upsertDailyPlatformMetrics(supabase, { date: now })
      lastRunDate = today
      console.log('[platform-metrics] Daily metrics written for', result.date, 'rows:', result.written)
      return result
    } finally {
      running = false
    }
  }

  return { maybeRunDailyMetrics: maybeRunDailyMetrics }
}

module.exports = {
  POLL_INTERVAL_MS,
  SUCCESS_STATUSES,
  RUN_TYPE_GROUPS,
  isSuccessStatus,
  metricDateString,
  uptimeColor,
  computeWorkerUptime,
  computeSystemMetrics,
  upsertDailyPlatformMetrics,
  createDailyMetricsScheduler,
}
