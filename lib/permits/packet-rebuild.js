// lib/permits/packet-rebuild.js
// ZIG-17 PR 4 Phase E: idempotent permit_packet rebuild enqueue.
// One queued/running permit_packet per job. Does not clone permit_phase_1.
// Does not enqueue from the rebuild worker itself (no evaluate→invalidate loop).
'use strict'

var { isUniqueViolation } = require('../documents/upsert-canonical-job-document')

var PERMIT_PACKET_RUN_TYPE = 'permit_packet'

var HEX64 = /^[0-9a-f]{64}$/
var REBUILD_REASON_PACKET_STALE = 'packet_stale'
var ACTIVE_RUN_STATUSES = Object.freeze(['queued', 'running'])

var REBUILD_INPUT_UNAVAILABLE = Object.freeze({
  LIVE_INCOMPLETE: 'live_incomplete',
  LIVE_EMPTY: 'live_empty',
  LIVE_UNUSABLE: 'live_unusable',
})

var ALLOWED_REASONS = Object.freeze([REBUILD_REASON_PACKET_STALE])
var ALLOWED_INPUT_MARKERS = Object.freeze(
  Object.keys(REBUILD_INPUT_UNAVAILABLE).map(function (key) {
    return REBUILD_INPUT_UNAVAILABLE[key]
  })
)

function isFingerprintHex(value) {
  return typeof value === 'string' && HEX64.test(value)
}

function isRebuildInputMarker(value) {
  return typeof value === 'string' && ALLOWED_INPUT_MARKERS.indexOf(value) !== -1
}

function isRebuildInputTarget(value) {
  return isFingerprintHex(value) || isRebuildInputMarker(value)
}

function validationError(message) {
  return Object.assign(new Error(message), {
    errorCode: 'packet_rebuild_invalid',
  })
}

function writeError(message, cause) {
  return Object.assign(new Error(message), {
    errorCode: 'packet_rebuild_write_failed',
    retryable: true,
    cause: cause || null,
  })
}

function reusedResult(run, extra) {
  return Object.assign(
    {
      run: run,
      created: false,
      reused: true,
    },
    extra || {}
  )
}

function createdResult(run) {
  return {
    run: run,
    created: true,
    reused: false,
  }
}

function validateQueueArgs(input) {
  var data = input || {}
  if (!data.supabase || typeof data.supabase.from !== 'function') {
    throw validationError('queuePermitPacketRebuild: supabase client is required')
  }
  if (!data.jobId) {
    throw validationError('queuePermitPacketRebuild: jobId is required')
  }
  if (!isRebuildInputTarget(data.inputFingerprint)) {
    throw validationError(
      'queuePermitPacketRebuild: inputFingerprint must be a lowercase 64-char hex digest or a live-input unavailable marker'
    )
  }
  if (ALLOWED_REASONS.indexOf(data.reason) === -1) {
    throw validationError(
      'queuePermitPacketRebuild: unsupported reason (expected packet_stale)'
    )
  }
}

async function findActivePermitPacketRun(supabase, jobId) {
  var result = await supabase
    .from('automation_runs')
    .select('*')
    .eq('job_id', jobId)
    .eq('run_type', PERMIT_PACKET_RUN_TYPE)
    .in('run_status', ACTIVE_RUN_STATUSES.slice())
    .maybeSingle()

  if (result.error) {
    throw writeError(
      'permit_packet rebuild lookup failed: ' + result.error.message,
      result.error
    )
  }
  return result.data || null
}

function buildRebuildPayload(inputFingerprint, reason) {
  return {
    rebuild_reason: reason,
    rebuild_for_input_fingerprint: inputFingerprint,
  }
}

/**
 * Queue at most one active permit_packet rebuild for a job.
 * Reuses queued/running rows regardless of payload fingerprint.
 *
 * Tenant scope is automation_runs.job_id → jobs.id → jobs.company_id.
 * automation_runs has no company_id column.
 *
 * @param {object} input
 * @param {object} input.supabase
 * @param {string} input.jobId
 * @param {string} input.inputFingerprint lowercase 64-char hex or live-input marker
 * @param {string} input.reason packet_stale
 * @returns {Promise<{ run: object, created: boolean, reused: boolean, raced?: boolean }>}
 */
async function queuePermitPacketRebuild(input) {
  validateQueueArgs(input)

  var supabase = input.supabase
  var jobId = input.jobId
  var reason = input.reason
  var inputFingerprint = input.inputFingerprint

  var existing = await findActivePermitPacketRun(supabase, jobId)
  if (existing && existing.id) {
    return reusedResult(existing)
  }

  var insert = await supabase
    .from('automation_runs')
    .insert({
      job_id: jobId,
      run_type: PERMIT_PACKET_RUN_TYPE,
      run_status: 'queued',
      attempts: 0,
      started_at: new Date().toISOString(),
      payload: buildRebuildPayload(inputFingerprint, reason),
    })
    .select('*')
    .single()

  if (!insert.error) {
    return createdResult(insert.data)
  }

  if (!isUniqueViolation(insert.error)) {
    throw writeError(
      'permit_packet rebuild insert failed: ' + insert.error.message,
      insert.error
    )
  }

  var winner = await findActivePermitPacketRun(supabase, jobId)
  if (winner && winner.id) {
    return reusedResult(winner, { raced: true })
  }

  throw writeError(
    'permit_packet unique violation but no active rebuild found: ' +
      insert.error.message,
    insert.error
  )
}

module.exports = {
  PERMIT_PACKET_RUN_TYPE: PERMIT_PACKET_RUN_TYPE,
  REBUILD_REASON_PACKET_STALE: REBUILD_REASON_PACKET_STALE,
  REBUILD_INPUT_UNAVAILABLE: REBUILD_INPUT_UNAVAILABLE,
  ACTIVE_RUN_STATUSES: ACTIVE_RUN_STATUSES,
  isFingerprintHex: isFingerprintHex,
  isRebuildInputTarget: isRebuildInputTarget,
  queuePermitPacketRebuild: queuePermitPacketRebuild,
  findActivePermitPacketRun: findActivePermitPacketRun,
}
