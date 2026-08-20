// lib/permits/packet-freshness.js
// ZIG-17 PR 4 Phase D–F: evaluate whether a ready packet is still current.
// Invalidates via RPC, then enqueues at most one permit_packet rebuild.
// Phase F mutation hooks call evaluatePacketFreshnessAfterMutation /
// maybeEvaluateCompanyPacketFreshness after successful writes.
'use strict'

var { computeLiveInputFingerprint } = require('./packet-fingerprint-adapter')
var { sha256Hex } = require('./packet-fingerprint')
var {
  downloadStorageBytes,
  identityConflictError,
} = require('./packet-documents')
var {
  queuePermitPacketRebuild,
  REBUILD_REASON_PACKET_STALE,
  REBUILD_INPUT_UNAVAILABLE,
} = require('./packet-rebuild')
var {
  packetRelevantCompanyFieldsChanged,
  PACKET_RELEVANT_COMPANY_COLUMNS,
} = require('./packet-field-map')

var READY_STATUS = 'ready_for_physical_submission'
var HEX64 = /^[0-9a-f]{64}$/
var INVALIDATE_RPC = 'invalidate_permit_packet_readiness'
var STORAGE_FAILED = 'packet_freshness_storage_failed'
var INVALIDATION_FAILED = 'permit_packet_invalidation_failed'
var SIDE_EFFECT_FAILED = 'packet_freshness_side_effect_failed'
var ALERT_PERSISTENCE_FAILED = 'packet_freshness_alert_persistence_failed'

var STALE_REASONS = Object.freeze({
  MISSING_STORED_FINGERPRINT: 'missing_stored_fingerprint',
  MISSING_SUBMISSION_PACKET: 'missing_submission_packet',
  PACKET_INPUTS_CHANGED: 'packet_inputs_changed',
  PACKET_CONTENT_CHANGED: 'packet_content_changed',
})

var NOOP_REASONS = Object.freeze({
  NOT_READY: 'not_ready',
  FINGERPRINT_CAS_MISMATCH: 'fingerprint_cas_mismatch',
})

var FRESHNESS_STATUS = Object.freeze({
  SKIPPED: 'skipped',
  FRESH: 'fresh',
  INVALIDATED: 'invalidated',
  NOT_READY: 'not_ready',
  CAS_MISMATCH: 'cas_mismatch',
  TRANSIENT_FAILURE: 'transient_failure',
  SIDE_EFFECT_FAILED: 'side_effect_failed',
})

function freshnessStorageFailed(detail, cause) {
  return Object.assign(
    new Error(STORAGE_FAILED + ': ' + (detail || 'storage download failed')),
    {
      errorCode: STORAGE_FAILED,
      retryable: true,
      nonRetryable: false,
      cause: cause || null,
    }
  )
}

function isTransientFreshnessError(err) {
  if (!err || typeof err !== 'object') return false
  if (err.sideEffectFailed === true) return false
  if (err.errorCode === STORAGE_FAILED) return true
  return err.retryable === true
}

function isProvenStaleTransitionFailure(err) {
  if (!err || typeof err !== 'object') return false
  if (err.sideEffectFailed === true) return true
  return err.errorCode === INVALIDATION_FAILED
}

function statusFromEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null
  if (evaluation.fresh === true) return FRESHNESS_STATUS.FRESH
  if (evaluation.invalidated === true) return FRESHNESS_STATUS.INVALIDATED
  if (evaluation.noop_reason === NOOP_REASONS.NOT_READY) return FRESHNESS_STATUS.NOT_READY
  if (evaluation.noop_reason === NOOP_REASONS.FINGERPRINT_CAS_MISMATCH) {
    return FRESHNESS_STATUS.CAS_MISMATCH
  }
  return null
}

function decorateCaughtFreshnessError(err, context) {
  var ctx = context || {}
  var jobId = (err && err.jobId) || ctx.jobId || null
  if (isProvenStaleTransitionFailure(err)) {
    return {
      ok: false,
      skipped: false,
      status: FRESHNESS_STATUS.SIDE_EFFECT_FAILED,
      side_effect_failed: true,
      retryable: false,
      errorCode: (err && err.errorCode) || INVALIDATION_FAILED,
      job_id: jobId,
      stale_reason: (err && err.staleReason) || null,
      error: err,
    }
  }
  return {
    ok: false,
    skipped: false,
    status: FRESHNESS_STATUS.TRANSIENT_FAILURE,
    side_effect_failed: false,
    retryable: isTransientFreshnessError(err),
    errorCode: (err && err.errorCode) || 'packet_freshness_evaluation_failed',
    job_id: jobId,
    error: err,
  }
}

function summarizeCompanyFreshnessResults(results) {
  var summary = {
    evaluated: 0,
    fresh: 0,
    invalidated: 0,
    transient_failures: 0,
    side_effect_failures: 0,
  }
  var rows = Array.isArray(results) ? results : []
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {}
    if (row.side_effect_failed === true || row.status === FRESHNESS_STATUS.SIDE_EFFECT_FAILED) {
      summary.side_effect_failures += 1
      continue
    }
    if (
      row.status === FRESHNESS_STATUS.TRANSIENT_FAILURE ||
      row.errorCode === STORAGE_FAILED ||
      (row.retryable === true && row.evaluated === false)
    ) {
      summary.transient_failures += 1
      continue
    }
    summary.evaluated += 1
    if (row.fresh === true) summary.fresh += 1
    if (row.invalidated === true) summary.invalidated += 1
  }
  return summary
}

function logPacketFreshnessSideEffect(classified, context) {
  var ctx = context || {}
  var payload = {
    jobId: classified.job_id || ctx.jobId || null,
    companyId: ctx.companyId || null,
    errorCode: classified.errorCode,
    retryable: classified.retryable === true,
    side_effect_failed: classified.side_effect_failed === true,
    stale_reason: classified.stale_reason || null,
  }
  if (classified.side_effect_failed === true) {
    console.error(
      '[packet-freshness] ' + SIDE_EFFECT_FAILED + '; mutation kept; job may remain ready',
      payload
    )
    return
  }
  console.warn(
    '[packet-freshness] post-mutation evaluation unavailable; mutation kept',
    payload
  )
}

/**
 * Durable ops signal for proven-stale invalidation failure.
 * No PR 4 primitive re-evaluates freshness without another mutation;
 * system_alerts is the existing observability surface (stuck_job).
 */
async function reportProvenStaleInvalidationFailure(context) {
  var ctx = context || {}
  var { sendAlert } = require('../monitoring/alert-service')
  return sendAlert({
    type: 'stuck_job',
    severity: 'critical',
    jobId: ctx.jobId || ctx.job_id || null,
    companyId: ctx.companyId || ctx.company_id || null,
    message:
      'Proven stale permit packet failed to invalidate; job may remain ready_for_physical_submission',
    details: {
      errorCode: ctx.errorCode || INVALIDATION_FAILED,
      classification: SIDE_EFFECT_FAILED,
      stale_reason: ctx.stale_reason || ctx.staleReason || null,
    },
  })
}

function logAlertPersistenceFailure(classified, context, alertErr) {
  var ctx = context || {}
  var payload = {
    jobId: classified.job_id || ctx.jobId || null,
    errorCode: classified.errorCode || null,
    stale_reason: classified.stale_reason || null,
    alertPersistenceCode: ALERT_PERSISTENCE_FAILED,
  }
  if (alertErr) {
    payload.alertError = (alertErr && alertErr.message) || 'alert_persistence_threw'
  }
  console.error('[packet-freshness] ' + ALERT_PERSISTENCE_FAILED, payload)
}

async function emitClassifiedFreshnessFailure(classified, context) {
  logPacketFreshnessSideEffect(classified, context)
  if (classified.side_effect_failed !== true) return classified
  try {
    var alertResult = await module.exports.reportProvenStaleInvalidationFailure({
      jobId: classified.job_id,
      companyId: context && context.companyId,
      errorCode: classified.errorCode,
      stale_reason: classified.stale_reason,
    })
    if (!alertResult || alertResult.persisted !== true) {
      logAlertPersistenceFailure(classified, context)
    }
  } catch (alertErr) {
    logAlertPersistenceFailure(classified, context, alertErr)
  }
  return classified
}

/**
 * Mutation has already committed. Never throw: callers must not retry or
 * roll back the original write because freshness failed.
 *
 * Transient evaluation-unavailable: warn, side_effect_failed=false.
 * Proven stale + invalidation failed: error + stuck_job alert, side_effect_failed=true.
 */
async function settlePostMutationFreshness(run, context) {
  var ctx = context || {}
  try {
    var result = await run()
    if (result && Array.isArray(result.results)) {
      var summary = summarizeCompanyFreshnessResults(result.results)
      var rows = result.results || []
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {}
        if (
          row.side_effect_failed === true ||
          row.status === FRESHNESS_STATUS.SIDE_EFFECT_FAILED ||
          row.status === FRESHNESS_STATUS.TRANSIENT_FAILURE ||
          row.errorCode
        ) {
          await emitClassifiedFreshnessFailure(
            {
              ok: false,
              status: row.side_effect_failed
                ? FRESHNESS_STATUS.SIDE_EFFECT_FAILED
                : FRESHNESS_STATUS.TRANSIENT_FAILURE,
              side_effect_failed: row.side_effect_failed === true,
              retryable: row.retryable === true,
              errorCode: row.errorCode,
              job_id: row.jobId || row.job_id || null,
              stale_reason: row.stale_reason || null,
            },
            ctx
          )
        }
      }
      return {
        ok: summary.side_effect_failures === 0 && summary.transient_failures === 0,
        skipped: false,
        status:
          summary.side_effect_failures > 0
            ? FRESHNESS_STATUS.SIDE_EFFECT_FAILED
            : summary.transient_failures > 0
              ? FRESHNESS_STATUS.TRANSIENT_FAILURE
              : null,
        side_effect_failed: summary.side_effect_failures > 0,
        company_id: ctx.companyId || result.companyId || null,
        result: Object.assign({}, result, { summary: summary }),
        summary: summary,
      }
    }

    var status = statusFromEvaluation(result)
    return {
      ok: true,
      skipped: false,
      status: status,
      side_effect_failed: false,
      job_id: (result && result.jobId) || ctx.jobId || null,
      result: result,
    }
  } catch (err) {
    var classified = decorateCaughtFreshnessError(err, ctx)
    await emitClassifiedFreshnessFailure(classified, ctx)
    return classified
  }
}

async function evaluatePacketFreshnessAfterMutation(jobId, supabase, options) {
  var opts = options || {}
  if (opts.skipPacketFreshness === true) {
    return {
      ok: true,
      skipped: true,
      status: FRESHNESS_STATUS.SKIPPED,
      side_effect_failed: false,
      job_id: jobId || null,
    }
  }
  if (!jobId || !supabase || typeof supabase.from !== 'function') {
    console.error('[packet-freshness] post-mutation skipped: missing jobId or supabase')
    return {
      ok: false,
      skipped: true,
      status: FRESHNESS_STATUS.SKIPPED,
      side_effect_failed: false,
      reason: 'missing_job_or_client',
      job_id: jobId || null,
    }
  }
  return settlePostMutationFreshness(
    function () {
      return module.exports.evaluatePacketFreshness(jobId, supabase)
    },
    { jobId: jobId }
  )
}

/**
 * After a successful companies update. No-ops when no packet-relevant
 * field-map column changed. Uses service-role supabase.
 */
async function maybeEvaluateCompanyPacketFreshness(companyId, updates, supabase) {
  if (!packetRelevantCompanyFieldsChanged(updates)) {
    return {
      ok: true,
      skipped: true,
      status: FRESHNESS_STATUS.SKIPPED,
      side_effect_failed: false,
      reason: 'no_packet_relevant_company_fields',
    }
  }
  if (!companyId) {
    console.error('[packet-freshness] company mutation missing companyId; skipped evaluation')
    return {
      ok: false,
      skipped: true,
      status: FRESHNESS_STATUS.SKIPPED,
      side_effect_failed: false,
      reason: 'missing_company_id',
    }
  }
  if (!supabase || typeof supabase.from !== 'function') {
    console.error('[packet-freshness] company mutation missing supabase; skipped evaluation')
    return {
      ok: false,
      skipped: true,
      status: FRESHNESS_STATUS.SKIPPED,
      side_effect_failed: false,
      reason: 'missing_supabase',
    }
  }
  return settlePostMutationFreshness(
    function () {
      return module.exports.evaluatePacketFreshnessForCompany(companyId, supabase)
    },
    { companyId: companyId }
  )
}

function isFingerprintHex(value) {
  return typeof value === 'string' && HEX64.test(value)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readStatusCode(error) {
  if (!error || typeof error !== 'object') return null
  var code = error.statusCode || error.status || error.httpStatusCode || error.status_code
  if (typeof code === 'string' && /^\d+$/.test(code)) return Number(code)
  return typeof code === 'number' ? code : null
}

function storageErrorText(error) {
  if (error == null) return ''
  if (typeof error === 'string') return error
  return String(error.message || error.error || error.name || '')
}

/**
 * Definitive missing vs retryable Storage failure.
 * Unknown errors are transient: cannot prove stale, must not invalidate.
 */
function classifyStorageDownloadError(error) {
  var status = readStatusCode(error)
  if (status === 404 || status === 400) return 'missing'
  if (status === 408 || status === 429) return 'transient'
  if (status != null && status >= 500 && status <= 599) return 'transient'

  var text = storageErrorText(error)
  if (
    /not[_ ]found/i.test(text) ||
    /no such object/i.test(text) ||
    /object.*does not exist/i.test(text) ||
    /NoSuchKey/i.test(text)
  ) {
    return 'missing'
  }
  return 'transient'
}

function readStoredFingerprint(job) {
  var specs = job && isPlainObject(job.job_specs) ? job.job_specs : {}
  var packet = isPlainObject(specs.packet) ? specs.packet : {}
  var fingerprint = isPlainObject(packet.fingerprint) ? packet.fingerprint : null
  var version = fingerprint && fingerprint.version
  var versionOk = version === 1 || version === '1'
  var input = fingerprint && fingerprint.input_fingerprint
  var content = fingerprint && fingerprint.content_fingerprint
  return {
    fingerprint: fingerprint,
    versionOk: versionOk === true,
    inputFingerprint: isFingerprintHex(input) ? input : null,
    contentFingerprint: isFingerprintHex(content) ? content : null,
    usableCasTarget: isFingerprintHex(input),
    usableEnvelope:
      versionOk === true && isFingerprintHex(input) && isFingerprintHex(content),
  }
}

/**
 * Deterministic stale-reason priority.
 * Inputs-changed wins when both hashes differ.
 */
function selectPacketStaleReason(flags) {
  var data = flags || {}
  if (data.missingStoredFingerprint === true) {
    return STALE_REASONS.MISSING_STORED_FINGERPRINT
  }
  if (data.missingSubmissionPacket === true) {
    return STALE_REASONS.MISSING_SUBMISSION_PACKET
  }
  if (data.inputMismatch === true) {
    return STALE_REASONS.PACKET_INPUTS_CHANGED
  }
  if (data.contentMismatch === true) {
    return STALE_REASONS.PACKET_CONTENT_CHANGED
  }
  return null
}

function notReadyResult(jobId, extra) {
  return Object.assign(
    {
      jobId: jobId || null,
      evaluated: false,
      fresh: null,
      invalidated: false,
      noop_reason: NOOP_REASONS.NOT_READY,
    },
    extra || {}
  )
}

async function loadJob(supabase, jobId) {
  if (!jobId) {
    throw new Error('evaluatePacketFreshness: jobId is required')
  }
  var result = await supabase
    .from('jobs')
    .select('id, company_id, ahj_id, job_status, job_specs')
    .eq('id', jobId)
    .maybeSingle()
  if (result.error) {
    throw new Error('packet_freshness job lookup failed: ' + result.error.message)
  }
  if (!result.data || !result.data.id) {
    throw new Error('packet_freshness job not found: ' + jobId)
  }
  return result.data
}

async function loadCanonicalSubmissionPacket(supabase, jobId) {
  var result = await supabase
    .from('job_documents')
    .select('id, file_path, document_type')
    .eq('job_id', jobId)
    .eq('document_type', 'submission_packet')
    .order('uploaded_at', { ascending: true })
  if (result.error) {
    throw new Error(
      'packet_freshness submission_packet lookup failed: ' + result.error.message
    )
  }
  var rows = result.data || []
  if (rows.length > 1) {
    throw identityConflictError({
      identityKind: 'submission_packet',
      jobId: jobId,
      documentType: 'submission_packet',
      candidateDocumentIds: rows.map(function (row) {
        return row && row.id
      }),
    })
  }
  return rows[0] || null
}

async function downloadCanonicalPacketBytes(supabase, filePath) {
  var downloaded = await downloadStorageBytes(supabase, filePath)
  if (downloaded.ok && downloaded.bytes && downloaded.bytes.length) {
    return { ok: true, bytes: downloaded.bytes }
  }
  if (downloaded.ok && downloaded.bytes && downloaded.bytes.length === 0) {
    return { ok: false, missing: true }
  }
  var kind = classifyStorageDownloadError(downloaded.error)
  if (kind === 'missing') return { ok: false, missing: true }
  throw freshnessStorageFailed(storageErrorText(downloaded.error), downloaded.error)
}

function liveInputUnusableError(err) {
  var code = err && err.errorCode
  return (
    code === 'packet_config_missing' ||
    code === 'packet_config_invalid'
  )
}

async function computeObservedInputFingerprint(supabase, job) {
  try {
    var live = await computeLiveInputFingerprint(supabase, job)
    if (!live || live.ok !== true || !isFingerprintHex(live.inputFingerprint)) {
      return {
        ok: false,
        inputFingerprint: null,
        reason: (live && live.reason) || REBUILD_INPUT_UNAVAILABLE.LIVE_UNUSABLE,
      }
    }
    return { ok: true, inputFingerprint: live.inputFingerprint }
  } catch (err) {
    if (liveInputUnusableError(err)) {
      return {
        ok: false,
        inputFingerprint: null,
        reason: REBUILD_INPUT_UNAVAILABLE.LIVE_UNUSABLE,
      }
    }
    throw err
  }
}

/**
 * Prefer a live hex digest. If current inputs cannot produce one, use an
 * explicit marker (not a fabricated hash) so the worker can still assemble
 * and emit packet_incomplete.
 */
async function resolveRebuildFingerprint(supabase, job) {
  try {
    var live = await computeLiveInputFingerprint(supabase, job)
    if (live && live.ok === true && isFingerprintHex(live.inputFingerprint)) {
      return live.inputFingerprint
    }
    if (live && live.reason === REBUILD_INPUT_UNAVAILABLE.LIVE_INCOMPLETE) {
      return REBUILD_INPUT_UNAVAILABLE.LIVE_INCOMPLETE
    }
    if (live && live.reason === REBUILD_INPUT_UNAVAILABLE.LIVE_EMPTY) {
      return REBUILD_INPUT_UNAVAILABLE.LIVE_EMPTY
    }
    return REBUILD_INPUT_UNAVAILABLE.LIVE_UNUSABLE
  } catch (err) {
    if (liveInputUnusableError(err)) {
      return REBUILD_INPUT_UNAVAILABLE.LIVE_UNUSABLE
    }
    throw err
  }
}

async function enqueueRebuildIfInvalidated(supabase, job, result, observed) {
  if (!result || result.invalidated !== true) return result

  var fingerprint =
    observed && observed.ok === true && isFingerprintHex(observed.inputFingerprint)
      ? observed.inputFingerprint
      : await resolveRebuildFingerprint(supabase, job)

  var queued = await queuePermitPacketRebuild({
    supabase: supabase,
    jobId: job.id,
    inputFingerprint: fingerprint,
    reason: REBUILD_REASON_PACKET_STALE,
  })

  return Object.assign({}, result, { rebuild: queued })
}

async function invalidateReadiness(supabase, jobId, options) {
  var opts = options || {}
  var expectMissing = opts.expectMissing === true
  var expected = expectMissing ? null : opts.expectedStoredInput
  var result = await supabase.rpc(INVALIDATE_RPC, {
    p_job_id: jobId,
    p_expected_stored_input_fingerprint: expected,
    p_expect_missing_stored_fingerprint: expectMissing,
    p_observed_input_fingerprint:
      opts.observedInput == null ? '' : String(opts.observedInput),
    p_reason: opts.reason,
  })
  if (result.error) {
    throw Object.assign(
      new Error(
        'invalidate_permit_packet_readiness failed: ' + result.error.message
      ),
      {
        errorCode: INVALIDATION_FAILED,
        sideEffectFailed: true,
        cause: result.error,
      }
    )
  }
  var data = result.data
  if (Array.isArray(data)) data = data[0]
  if (!data || data.ok !== true) {
    throw Object.assign(
      new Error('invalidate_permit_packet_readiness returned unexpected payload'),
      {
        errorCode: INVALIDATION_FAILED,
        sideEffectFailed: true,
      }
    )
  }
  return data
}

function applyInvalidationResponse(jobId, reason, rpcPayload, observedInput) {
  if (rpcPayload.invalidated === true) {
    return {
      jobId: jobId,
      evaluated: true,
      fresh: false,
      invalidated: true,
      reason: reason,
      observed_input_fingerprint: observedInput || null,
    }
  }
  var noop = rpcPayload.noop_reason || null
  return {
    jobId: jobId,
    evaluated: true,
    fresh: null,
    invalidated: false,
    reason: reason,
    noop_reason: noop,
    observed_input_fingerprint: observedInput || null,
  }
}

async function invalidateProvenStale(supabase, jobId, stored, observedInput, reason) {
  var expectMissing = !(stored && stored.usableCasTarget)
  try {
    var rpcPayload = await invalidateReadiness(supabase, jobId, {
      expectedStoredInput: expectMissing ? null : stored.inputFingerprint,
      expectMissing: expectMissing,
      observedInput: observedInput,
      reason: reason,
    })
    return applyInvalidationResponse(jobId, reason, rpcPayload, observedInput)
  } catch (err) {
    throw Object.assign(err, {
      errorCode: (err && err.errorCode) || INVALIDATION_FAILED,
      sideEffectFailed: true,
      jobId: jobId,
      staleReason: reason,
    })
  }
}

/**
 * Evaluate whether a ready job's stored packet fingerprint still matches
 * live inputs and the durable canonical submission_packet bytes.
 *
 * @param {string} jobId
 * @param {object} supabase
 */
async function evaluatePacketFreshness(jobId, supabase) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw new Error('evaluatePacketFreshness: supabase client is required')
  }

  var job = await loadJob(supabase, jobId)
  if (job.job_status !== READY_STATUS) {
    return notReadyResult(job.id)
  }

  var stored = readStoredFingerprint(job)
  if (!stored.usableEnvelope) {
    return enqueueRebuildIfInvalidated(
      supabase,
      job,
      await invalidateProvenStale(
        supabase,
        job.id,
        stored,
        '',
        STALE_REASONS.MISSING_STORED_FINGERPRINT
      )
    )
  }

  var observed = await computeObservedInputFingerprint(supabase, job)
  var inputMismatch = observed.ok !== true || observed.inputFingerprint !== stored.inputFingerprint
  if (inputMismatch) {
    var inputReason = selectPacketStaleReason({ inputMismatch: true })
    return enqueueRebuildIfInvalidated(
      supabase,
      job,
      await invalidateProvenStale(
        supabase,
        job.id,
        stored,
        observed.inputFingerprint,
        inputReason
      ),
      observed
    )
  }

  var packetRow = await loadCanonicalSubmissionPacket(supabase, job.id)
  var filePath = packetRow && packetRow.file_path
  if (!packetRow || typeof filePath !== 'string' || filePath.trim() === '') {
    var missingPacketReason = selectPacketStaleReason({ missingSubmissionPacket: true })
    return enqueueRebuildIfInvalidated(
      supabase,
      job,
      await invalidateProvenStale(
        supabase,
        job.id,
        stored,
        observed.inputFingerprint,
        missingPacketReason
      ),
      observed
    )
  }

  var downloaded = await downloadCanonicalPacketBytes(supabase, filePath)
  if (!downloaded.ok) {
    var missingBytesReason = selectPacketStaleReason({ missingSubmissionPacket: true })
    return enqueueRebuildIfInvalidated(
      supabase,
      job,
      await invalidateProvenStale(
        supabase,
        job.id,
        stored,
        observed.inputFingerprint,
        missingBytesReason
      ),
      observed
    )
  }

  var liveContent = sha256Hex(downloaded.bytes)
  if (liveContent === stored.contentFingerprint) {
    return {
      jobId: job.id,
      evaluated: true,
      fresh: true,
      invalidated: false,
    }
  }

  var contentReason = selectPacketStaleReason({
    inputMismatch: false,
    contentMismatch: true,
  })
  return enqueueRebuildIfInvalidated(
    supabase,
    job,
    await invalidateProvenStale(
      supabase,
      job.id,
      stored,
      observed.inputFingerprint,
      contentReason
    ),
    observed
  )
}

async function listReadyJobIds(supabase, filters) {
  var query = supabase
    .from('jobs')
    .select('id')
    .eq('job_status', READY_STATUS)
  if (filters.companyId) query = query.eq('company_id', filters.companyId)
  if (filters.ahjId) query = query.eq('ahj_id', filters.ahjId)
  var result = await query
  if (result.error) {
    throw new Error('packet_freshness ready-job listing failed: ' + result.error.message)
  }
  return (result.data || [])
    .map(function (row) {
      return row && row.id
    })
    .filter(Boolean)
}

async function evaluateReadyJobs(supabase, jobIds) {
  var results = []
  for (var i = 0; i < jobIds.length; i++) {
    var id = jobIds[i]
    try {
      var evaluation = await module.exports.evaluatePacketFreshness(id, supabase)
      results.push(Object.assign({ jobId: id }, evaluation))
    } catch (err) {
      var classified = decorateCaughtFreshnessError(err, { jobId: id })
      results.push({
        jobId: id,
        evaluated: false,
        fresh: null,
        invalidated: false,
        status: classified.status,
        errorCode: classified.errorCode,
        retryable: classified.retryable === true,
        side_effect_failed: classified.side_effect_failed === true,
        stale_reason: classified.stale_reason || null,
      })
    }
  }
  return results
}

/**
 * Ready jobs for one tenant only. Sequential at current pilot scale.
 */
async function evaluatePacketFreshnessForCompany(companyId, supabase) {
  if (!companyId) {
    throw new Error('evaluatePacketFreshnessForCompany: companyId is required')
  }
  var jobIds = await listReadyJobIds(supabase, { companyId: companyId })
  var results = await evaluateReadyJobs(supabase, jobIds)
  return {
    companyId: companyId,
    results: results,
    summary: summarizeCompanyFreshnessResults(results),
  }
}

/**
 * Ready jobs for one AHJ via jobs.ahj_id. Not wired to routes (Phase D).
 */
async function evaluatePacketFreshnessForAhj(ahjId, supabase) {
  if (!ahjId) {
    throw new Error('evaluatePacketFreshnessForAhj: ahjId is required')
  }
  var jobIds = await listReadyJobIds(supabase, { ahjId: ahjId })
  var results = await evaluateReadyJobs(supabase, jobIds)
  return {
    ahjId: ahjId,
    results: results,
    summary: summarizeCompanyFreshnessResults(results),
  }
}

module.exports = {
  STALE_REASONS: STALE_REASONS,
  NOOP_REASONS: NOOP_REASONS,
  FRESHNESS_STATUS: FRESHNESS_STATUS,
  STORAGE_FAILED: STORAGE_FAILED,
  INVALIDATION_FAILED: INVALIDATION_FAILED,
  SIDE_EFFECT_FAILED: SIDE_EFFECT_FAILED,
  ALERT_PERSISTENCE_FAILED: ALERT_PERSISTENCE_FAILED,
  PACKET_RELEVANT_COMPANY_COLUMNS: PACKET_RELEVANT_COMPANY_COLUMNS,
  packetRelevantCompanyFieldsChanged: packetRelevantCompanyFieldsChanged,
  evaluatePacketFreshness: evaluatePacketFreshness,
  evaluatePacketFreshnessForCompany: evaluatePacketFreshnessForCompany,
  evaluatePacketFreshnessForAhj: evaluatePacketFreshnessForAhj,
  evaluatePacketFreshnessAfterMutation: evaluatePacketFreshnessAfterMutation,
  maybeEvaluateCompanyPacketFreshness: maybeEvaluateCompanyPacketFreshness,
  reportProvenStaleInvalidationFailure: reportProvenStaleInvalidationFailure,
  summarizeCompanyFreshnessResults: summarizeCompanyFreshnessResults,
  selectPacketStaleReason: selectPacketStaleReason,
  classifyStorageDownloadError: classifyStorageDownloadError,
  readStoredFingerprint: readStoredFingerprint,
}
