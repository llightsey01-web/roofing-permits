// lib/ahj/ahj-readiness-dashboard.js
// PR A: derived AHJ validation / pilot readiness aggregation (no persistence).
// Batched reads only — presence/status, never credentials or secrets.

'use strict'

var readiness = require('./ahj-readiness.js')
var packetConfig = require('./packet-config.js')
var workflowDispatch = require('../automation/workflow-type-dispatch.js')

var RELEVANT_RUN_TYPES = new Set([
  'permit_phase_1',
  'permit_resume',
  'permit_packet',
  'permit_document_upload',
])

// Architecture exception: normalize live `complete` + approved `completed`.
var SUCCESS_STATUSES = new Set(['needs_review', 'complete', 'completed'])
var FAILURE_STATUSES = new Set(['error', 'failed'])

var MAX_RUNS_PER_AHJ = 20
var MAX_ERROR_CHARS = 200

// Workflow files recognized by worker/runner.js switch — file ids, not AHJ names.
var RECOGNIZED_PORTAL_WORKFLOW_FILES = new Set([
  'polk-county.runner.js',
  'lee-county.runner.js',
  'hillsborough-county.runner.js',
  'pinellas-county.runner.js',
  'pasco-county.runner.js',
  'sarasota-county.runner.js',
  'charlotte-county.runner.js',
  'lake-county.runner.js',
  'manatee-county.runner.js',
  'brevard-county.runner.js',
  'osceola-county.runner.js',
  'citrus-county.runner.js',
])

var SECRETISH_PATTERNS = [
  /password[=:\s][^\s,;]+/gi,
  /passwd[=:\s][^\s,;]+/gi,
  /secret[=:\s][^\s,;]+/gi,
  /token[=:\s][^\s,;]+/gi,
  /api[_-]?key[=:\s][^\s,;]+/gi,
  /service[_-]?role[^\s,;]*/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g,
]

/**
 * Truncate + redact automation/error text before leaving the service layer.
 * @param {unknown} value
 * @returns {string|null}
 */
function sanitizeDashboardError(value) {
  if (value == null) return null
  var text = String(value)
  if (!text) return null

  for (var i = 0; i < SECRETISH_PATTERNS.length; i++) {
    text = text.replace(SECRETISH_PATTERNS[i], '[redacted]')
  }

  // Drop obvious stack-trace frames
  text = text
    .split('\n')
    .filter(function (line) {
      return !/^\s*at\s+/.test(line)
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > MAX_ERROR_CHARS) {
    text = text.slice(0, MAX_ERROR_CHARS)
  }
  return text || null
}

function emptyRunMetrics() {
  return {
    last_relevant_run_at: null,
    last_success_at: null,
    last_failure_at: null,
    relevant_run_count: 0,
    success_count: 0,
    failure_count: 0,
    recent_failure_streak: 0,
    last_error_message: null,
  }
}

/**
 * Aggregate the most recent relevant runs for one AHJ (already filtered/sorted).
 * Unknown statuses count as neither success nor failure.
 * @param {object[]} runs newest-first
 */
function aggregateRunMetrics(runs) {
  var metrics = emptyRunMetrics()
  var list = (runs || []).slice(0, MAX_RUNS_PER_AHJ)
  metrics.relevant_run_count = list.length
  if (!list.length) return metrics

  metrics.last_relevant_run_at = list[0].started_at || list[0].completed_at || null

  var streak = 0
  var streakActive = true

  for (var i = 0; i < list.length; i++) {
    var run = list[i] || {}
    var status = run.run_status
    var at = run.completed_at || run.started_at || null

    if (SUCCESS_STATUSES.has(status)) {
      metrics.success_count += 1
      if (!metrics.last_success_at) metrics.last_success_at = at
      streakActive = false
    } else if (FAILURE_STATUSES.has(status)) {
      metrics.failure_count += 1
      if (!metrics.last_failure_at) metrics.last_failure_at = at
      if (streakActive) streak += 1
      if (!metrics.last_error_message && run.error_message) {
        metrics.last_error_message = sanitizeDashboardError(run.error_message)
      }
    } else {
      // unknown — neither success nor failure; does not extend failure streak
      streakActive = false
      if (status != null && status !== '') {
        console.warn(
          '[ahj-readiness-dashboard] unknown run_status ignored:',
          String(status).slice(0, 64)
        )
      }
    }
  }

  metrics.recent_failure_streak = streak
  return metrics
}

/**
 * @returns {'configured'|'missing'|'not_required'|'unknown'}
 */
function resolveCredentialStatus(ahj, credentialPresenceByAhjId, lookupFailed) {
  if (lookupFailed) return 'unknown'
  var wt = ahj && ahj.workflow_type
  if (wt === 'pdf_packet' || wt === 'hybrid' || wt === 'email') {
    return 'not_required'
  }
  if (wt !== 'portal') {
    // Unrecognized types: treat as not required for portal login (unsupported is separate).
    return 'not_required'
  }
  var id = ahj && ahj.id
  if (!id) return 'unknown'
  if (credentialPresenceByAhjId && credentialPresenceByAhjId[id] === true) {
    return 'configured'
  }
  return 'missing'
}

/**
 * Configuration readiness for portal / pdf_packet / unsupported.
 * pdf_packet derives from packet readiness (no duplicated packet rules).
 *
 * @returns {{ status: 'ready'|'incomplete'|'not_applicable'|'unknown', reasons: string[] }}
 */
function resolveConfigStatus(ahj, packetStatus) {
  var reasons = []
  if (!ahj) {
    return { status: 'unknown', reasons: ['AHJ row missing'] }
  }

  var family = workflowDispatch.selectExecutionFamily(ahj.workflow_type)

  if (family === workflowDispatch.UNSUPPORTED_FAMILY) {
    reasons.push('workflow_type is unsupported for permit execution')
    return { status: 'not_applicable', reasons: reasons }
  }

  if (family === workflowDispatch.PDF_PACKET_FAMILY) {
    if (!packetStatus || packetStatus.status === 'not_applicable') {
      return { status: 'unknown', reasons: ['packet status unavailable'] }
    }
    if (packetStatus.status === 'ready') {
      return { status: 'ready', reasons: [] }
    }
    if (packetStatus.status === 'missing') {
      reasons.push(packetStatus.reason || 'packet configuration missing')
      return { status: 'incomplete', reasons: reasons }
    }
    reasons.push(packetStatus.reason || 'packet configuration invalid')
    return { status: 'incomplete', reasons: reasons }
  }

  // portal family
  if (ahj.workflow_type !== 'portal') {
    reasons.push('unrecognized portal workflow')
    return { status: 'incomplete', reasons: reasons }
  }
  if (ahj.workflow_file == null || ahj.workflow_file === '') {
    reasons.push('portal workflow_file is missing')
    return { status: 'incomplete', reasons: reasons }
  }
  if (!RECOGNIZED_PORTAL_WORKFLOW_FILES.has(String(ahj.workflow_file))) {
    reasons.push('workflow runner is not recognized by dispatch architecture')
    return { status: 'incomplete', reasons: reasons }
  }
  return { status: 'ready', reasons: [] }
}

/**
 * Deterministic blocker list (derived only). Soft validation blockers may
 * appear after hard gates; pilot_ready uses hard checklist items only.
 *
 * @returns {{ primary_blocker: string|null, all_blockers: string[] }}
 */
function deriveBlockers(ahj, credentialStatus, configStatus, packetStatus, runMetrics) {
  var all = []

  if (!ahj || ahj.is_active !== true) {
    all.push('inactive')
  }

  var family = workflowDispatch.selectExecutionFamily(ahj && ahj.workflow_type)
  if (family === workflowDispatch.UNSUPPORTED_FAMILY) {
    all.push('unsupported_workflow')
  }

  var lifecycle = ahj && ahj.lifecycle_state
  if (!readiness.EXECUTABLE_LIFECYCLES[lifecycle]) {
    all.push('lifecycle_not_pilot_production')
  }

  if (ahj && ahj.operational_health === 'unavailable') {
    all.push('operational_health_unavailable')
  }

  if (credentialStatus === 'missing') {
    all.push('required_credentials_missing')
  }

  if (configStatus && configStatus.status === 'incomplete') {
    all.push('workflow_configuration_incomplete')
  }

  if (
    ahj &&
    ahj.workflow_type === 'pdf_packet' &&
    packetStatus &&
    (packetStatus.status === 'missing' || packetStatus.status === 'invalid')
  ) {
    all.push(
      packetStatus.status === 'missing'
        ? 'packet_configuration_missing'
        : 'packet_configuration_invalid'
    )
  }

  var metrics = runMetrics || emptyRunMetrics()
  if (metrics.success_count === 0) {
    all.push('no_successful_validation')
  }
  if (metrics.recent_failure_streak > 0) {
    all.push('repeated_recent_failures')
  }

  return {
    primary_blocker: all.length ? all[0] : null,
    all_blockers: all,
  }
}

/**
 * 11-item machine-derived pilot checklist.
 * Hard items gate pilot_ready; informational items do not.
 */
function buildPilotChecklist(ahj, credentialStatus, configStatus, packetStatus, runMetrics, contractorVisible, workerExecutable) {
  var family = workflowDispatch.selectExecutionFamily(ahj && ahj.workflow_type)
  var metrics = runMetrics || emptyRunMetrics()

  var items = [
    {
      label: 'AHJ active',
      passed: !!(ahj && ahj.is_active === true),
      blocking: true,
    },
    {
      label: 'workflow supported',
      passed: family !== workflowDispatch.UNSUPPORTED_FAMILY,
      blocking: true,
    },
    {
      label: 'lifecycle pilot/production',
      passed: !!(ahj && readiness.EXECUTABLE_LIFECYCLES[ahj.lifecycle_state]),
      blocking: true,
    },
    {
      label: 'health not unavailable',
      passed: !!(ahj && ahj.operational_health !== 'unavailable'),
      blocking: true,
    },
    {
      label: 'credentials configured/not required',
      passed: credentialStatus === 'configured' || credentialStatus === 'not_required',
      blocking: true,
    },
    {
      label: 'workflow configuration complete',
      passed: !!(configStatus && configStatus.status === 'ready'),
      blocking: true,
    },
    {
      label: 'packet configuration valid when applicable',
      passed:
        !ahj ||
        ahj.workflow_type !== 'pdf_packet' ||
        (packetStatus && packetStatus.status === 'ready'),
      blocking: true,
    },
    {
      label: 'successful validation exists',
      passed: metrics.success_count > 0,
      blocking: false,
    },
    {
      label: 'no current consecutive failure streak',
      passed: metrics.recent_failure_streak === 0,
      blocking: false,
    },
    {
      label: 'contractor visibility',
      passed: contractorVisible === true,
      blocking: false,
    },
    {
      label: 'worker executable',
      passed: workerExecutable === true,
      blocking: false,
    },
  ]

  var pilotReady = items.every(function (item) {
    return !item.blocking || item.passed
  })

  return { items: items, pilot_ready: pilotReady }
}

/**
 * Pure row builder — unit-testable without Supabase.
 * @param {object} ahj
 * @param {object} runMetrics
 * @param {string} credentialStatus
 * @param {object} packetStatus
 * @param {'company'|'platform'=} credentialScope
 */
function buildAhjDashboardRow(ahj, runMetrics, credentialStatus, packetStatus, credentialScope) {
  if (!ahj) {
    return buildUnknownRow(null, 'AHJ row missing', credentialScope)
  }

  var metrics = runMetrics || emptyRunMetrics()
  var packet =
    packetStatus ||
    packetConfig.evaluatePacketReadinessFromRows(null, ahj.workflow_type)
  var configStatus = resolveConfigStatus(ahj, packet)
  var credStatus = credentialStatus || 'unknown'
  var scope = credentialScope === 'company' ? 'company' : 'platform'

  var visibility = readiness.getContractorVisibilityReasons(ahj)
  var execution = readiness.getWorkerExecutionReasons(ahj)
  var blockers = deriveBlockers(ahj, credStatus, configStatus, packet, metrics)
  var checklist = buildPilotChecklist(
    ahj,
    credStatus,
    configStatus,
    packet,
    metrics,
    visibility.visible,
    execution.executable
  )

  return {
    id: ahj.id,
    name: ahj.name || null,
    county_or_city: ahj.county_or_city || null,
    state: ahj.state || null,
    workflow_type: ahj.workflow_type || null,
    submission_method: ahj.submission_method || null,

    lifecycle_state: ahj.lifecycle_state || null,
    operational_health: ahj.operational_health || null,
    is_active: ahj.is_active === true,

    contractor_visible: visibility.visible,
    contractor_visibility_reasons: visibility.reasons,
    contractor_visibility_blocking: visibility.blocking_reason,

    worker_executable: execution.executable,
    worker_execution_reasons: execution.reasons,
    worker_execution_blocking: execution.blocking_reason,

    credential_scope: scope,
    credential_status: credStatus,
    config_status: configStatus,
    packet_status: {
      status: packet.status,
      reason: packet.reason ? sanitizeDashboardError(packet.reason) : undefined,
    },

    last_relevant_run_at: metrics.last_relevant_run_at,
    last_success_at: metrics.last_success_at,
    last_failure_at: metrics.last_failure_at,
    relevant_run_count: metrics.relevant_run_count,
    success_count: metrics.success_count,
    failure_count: metrics.failure_count,
    recent_failure_streak: metrics.recent_failure_streak,
    last_error_message: metrics.last_error_message || null,

    primary_blocker: blockers.primary_blocker,
    all_blockers: blockers.all_blockers,

    pilot_checklist: checklist.items,
    pilot_ready: checklist.pilot_ready,
  }
}

function buildUnknownRow(ahjId, reason, credentialScope) {
  var safeReason = sanitizeDashboardError(reason) || 'evaluation failed'
  return {
    id: ahjId || null,
    name: null,
    county_or_city: null,
    state: null,
    workflow_type: null,
    submission_method: null,
    lifecycle_state: null,
    operational_health: null,
    is_active: false,
    contractor_visible: false,
    contractor_visibility_reasons: [safeReason],
    contractor_visibility_blocking: 'unknown',
    worker_executable: false,
    worker_execution_reasons: [safeReason],
    worker_execution_blocking: 'unknown',
    credential_scope: credentialScope === 'company' ? 'company' : 'platform',
    credential_status: 'unknown',
    config_status: { status: 'unknown', reasons: [safeReason] },
    packet_status: { status: 'not_applicable' },
    last_relevant_run_at: null,
    last_success_at: null,
    last_failure_at: null,
    relevant_run_count: 0,
    success_count: 0,
    failure_count: 0,
    recent_failure_streak: 0,
    last_error_message: null,
    primary_blocker: 'unknown',
    all_blockers: ['unknown'],
    pilot_checklist: [],
    pilot_ready: false,
  }
}

function ahjPortalSelect() {
  return [
    'id',
    'name',
    'county_or_city',
    'state',
    'workflow_type',
    'submission_method',
    'lifecycle_state',
    'operational_health',
    'is_active',
    'workflow_file',
  ].join(', ')
}

/**
 * Batch: which AHJs have ≥1 active vault or legacy credential with presence.
 * Queries filter for presence server-side and select only ahj_id — never
 * load usernames, passwords, or ciphertext into the dashboard path.
 *
 * When companyId is set, presence is scoped to that company only.
 * When omitted, presence is platform-wide (any company).
 *
 * @param {object} supabase
 * @param {string[]} ahjIds
 * @param {string|null|undefined} companyId
 */
async function loadCredentialPresenceByAhjId(supabase, ahjIds, companyId) {
  var presence = Object.create(null)
  if (!ahjIds || !ahjIds.length) {
    return { presence: presence, lookupFailed: false }
  }

  var vaultQuery = supabase
    .from('company_credentials')
    .select('ahj_id')
    .in('ahj_id', ahjIds)
    .eq('is_active', true)
    .not('encrypted_username', 'is', null)
    .not('encrypted_password', 'is', null)

  if (companyId) {
    vaultQuery = vaultQuery.eq('company_id', companyId)
  }

  var vaultRes = await vaultQuery

  if (vaultRes.error) {
    console.warn(
      '[ahj-readiness-dashboard] credential vault lookup failed:',
      sanitizeDashboardError(vaultRes.error.message)
    )
    return { presence: presence, lookupFailed: true }
  }

  ;(vaultRes.data || []).forEach(function (row) {
    if (row && row.ahj_id) presence[row.ahj_id] = true
  })

  var legacyQuery = supabase
    .from('company_ahj_credentials')
    .select('ahj_id')
    .in('ahj_id', ahjIds)
    .eq('is_active', true)
    .not('username', 'is', null)
    .or('password_encrypted.not.is.null,portal_password.not.is.null')

  if (companyId) {
    legacyQuery = legacyQuery.eq('company_id', companyId)
  }

  var legacyRes = await legacyQuery

  if (legacyRes.error) {
    console.warn(
      '[ahj-readiness-dashboard] legacy credential lookup failed:',
      sanitizeDashboardError(legacyRes.error.message)
    )
    return { presence: presence, lookupFailed: true }
  }

  ;(legacyRes.data || []).forEach(function (row) {
    if (row && row.ahj_id) presence[row.ahj_id] = true
  })

  return { presence: presence, lookupFailed: false }
}

/**
 * Batch packet requirements for pdf_packet AHJs (one query).
 */
async function loadPacketRequirementsByAhjId(supabase, pdfPacketAhjIds) {
  var byAhj = Object.create(null)
  if (!pdfPacketAhjIds || !pdfPacketAhjIds.length) {
    return { byAhj: byAhj, lookupFailed: false }
  }

  var result = await supabase
    .from('ahj_document_requirements')
    .select('*')
    .in('ahj_id', pdfPacketAhjIds)
    .order('sort_order', { ascending: true })
    .order('document_role', { ascending: true })

  if (result.error) {
    console.warn(
      '[ahj-readiness-dashboard] packet requirements lookup failed:',
      sanitizeDashboardError(result.error.message)
    )
    return { byAhj: byAhj, lookupFailed: true }
  }

  ;(result.data || []).forEach(function (row) {
    if (!row || !row.ahj_id) return
    if (!byAhj[row.ahj_id]) byAhj[row.ahj_id] = []
    byAhj[row.ahj_id].push(row)
  })

  return { byAhj: byAhj, lookupFailed: false }
}

/**
 * Batch run metrics via jobs.ahj_id (no N+1).
 * Query plan: jobs for AHJ ids → automation_runs filtered by job_id + relevant types.
 */
async function loadRunMetricsByAhjId(supabase, ahjIds) {
  var metricsByAhj = Object.create(null)
  ahjIds.forEach(function (id) {
    metricsByAhj[id] = emptyRunMetrics()
  })
  if (!ahjIds || !ahjIds.length) {
    return { metricsByAhj: metricsByAhj, lookupFailed: false }
  }

  var jobsRes = await supabase.from('jobs').select('id, ahj_id').in('ahj_id', ahjIds)
  if (jobsRes.error) {
    console.warn(
      '[ahj-readiness-dashboard] jobs lookup failed:',
      sanitizeDashboardError(jobsRes.error.message)
    )
    return { metricsByAhj: metricsByAhj, lookupFailed: true }
  }

  var jobToAhj = Object.create(null)
  var jobIds = []
  ;(jobsRes.data || []).forEach(function (job) {
    if (!job || !job.id || !job.ahj_id) return
    jobToAhj[job.id] = job.ahj_id
    jobIds.push(job.id)
  })

  if (!jobIds.length) {
    return { metricsByAhj: metricsByAhj, lookupFailed: false }
  }

  // Chunk job ids to stay under URL/filter limits
  var CHUNK = 200
  var runsByAhj = Object.create(null)
  ahjIds.forEach(function (id) {
    runsByAhj[id] = []
  })

  for (var offset = 0; offset < jobIds.length; offset += CHUNK) {
    var chunk = jobIds.slice(offset, offset + CHUNK)
    var runsRes = await supabase
      .from('automation_runs')
      .select('id, job_id, run_type, run_status, started_at, completed_at, error_message')
      .in('job_id', chunk)
      .in('run_type', Array.from(RELEVANT_RUN_TYPES))
      .order('started_at', { ascending: false })
      // Cap per chunk; final per-AHJ window applied in aggregateRunMetrics.
      .limit(5000)

    if (runsRes.error) {
      console.warn(
        '[ahj-readiness-dashboard] automation_runs lookup failed:',
        sanitizeDashboardError(runsRes.error.message)
      )
      return { metricsByAhj: metricsByAhj, lookupFailed: true }
    }

    ;(runsRes.data || []).forEach(function (run) {
      if (!run || !RELEVANT_RUN_TYPES.has(run.run_type)) return
      var ahjId = jobToAhj[run.job_id]
      if (!ahjId) return
      if (!runsByAhj[ahjId]) runsByAhj[ahjId] = []
      runsByAhj[ahjId].push(run)
    })
  }

  Object.keys(runsByAhj).forEach(function (ahjId) {
    var list = runsByAhj[ahjId] || []
    list.sort(function (a, b) {
      var at = new Date(a.started_at || a.completed_at || 0).getTime()
      var bt = new Date(b.started_at || b.completed_at || 0).getTime()
      return bt - at
    })
    metricsByAhj[ahjId] = aggregateRunMetrics(list)
  })

  return { metricsByAhj: metricsByAhj, lookupFailed: false }
}

/**
 * @param {object} supabase
 * @param {{ ahjIds?: string[], companyId?: string }=} opts
 */
async function loadAhjDashboardRows(supabase, opts) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw new Error('loadAhjDashboardRows: supabase client is required')
  }

  opts = opts || {}
  var companyId = opts.companyId || null
  var credentialScope = companyId ? 'company' : 'platform'

  var query = supabase.from('ahj_portals').select(ahjPortalSelect()).order('name', {
    ascending: true,
  })

  if (Array.isArray(opts.ahjIds) && opts.ahjIds.length) {
    query = query.in('id', opts.ahjIds)
  }

  var portalsRes = await query
  if (portalsRes.error) {
    throw new Error(
      'Failed to load ahj_portals: ' + (sanitizeDashboardError(portalsRes.error.message) || 'unknown')
    )
  }

  var portals = portalsRes.data || []
  var ahjIds = portals.map(function (p) {
    return p.id
  })

  var pdfPacketIds = portals
    .filter(function (p) {
      return p && p.workflow_type === 'pdf_packet'
    })
    .map(function (p) {
      return p.id
    })

  var credPromise = loadCredentialPresenceByAhjId(supabase, ahjIds, companyId)
  var runsPromise = loadRunMetricsByAhjId(supabase, ahjIds)
  var packetPromise = loadPacketRequirementsByAhjId(supabase, pdfPacketIds)

  var credResult = await credPromise
  var runsResult = await runsPromise
  var packetResult = await packetPromise

  return portals.map(function (ahj) {
    try {
      var packetStatus
      if (ahj.workflow_type === 'pdf_packet') {
        if (packetResult.lookupFailed) {
          packetStatus = { status: 'invalid', reason: 'packet readiness evaluation failed' }
        } else {
          packetStatus = packetConfig.evaluatePacketReadinessFromRows(
            packetResult.byAhj[ahj.id] || [],
            ahj.workflow_type
          )
        }
      } else {
        packetStatus = { status: 'not_applicable' }
      }

      var credentialStatus = resolveCredentialStatus(
        ahj,
        credResult.presence,
        credResult.lookupFailed
      )
      var runMetrics = runsResult.metricsByAhj[ahj.id] || emptyRunMetrics()

      return buildAhjDashboardRow(
        ahj,
        runMetrics,
        credentialStatus,
        packetStatus,
        credentialScope
      )
    } catch (err) {
      console.warn(
        '[ahj-readiness-dashboard] row evaluation failed for',
        ahj && ahj.id,
        sanitizeDashboardError(err && err.message)
      )
      return buildUnknownRow(ahj && ahj.id, err && err.message, credentialScope)
    }
  })
}

/**
 * @param {object} supabase
 * @param {string} ahjId
 * @param {{ companyId?: string }=} opts
 */
async function loadAhjDashboardRow(supabase, ahjId, opts) {
  if (!ahjId) {
    return null
  }
  opts = opts || {}
  var rows = await loadAhjDashboardRows(supabase, {
    ahjIds: [ahjId],
    companyId: opts.companyId,
  })
  return rows && rows.length ? rows[0] : null
}

module.exports = {
  loadAhjDashboardRows,
  loadAhjDashboardRow,
  buildAhjDashboardRow,
  sanitizeDashboardError,
  aggregateRunMetrics,
  resolveCredentialStatus,
  resolveConfigStatus,
  deriveBlockers,
  buildPilotChecklist,
  emptyRunMetrics,
  RELEVANT_RUN_TYPES,
  SUCCESS_STATUSES,
  FAILURE_STATUSES,
  RECOGNIZED_PORTAL_WORKFLOW_FILES,
  MAX_RUNS_PER_AHJ,
}
