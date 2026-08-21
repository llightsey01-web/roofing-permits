// lib/automation/permit-packet.js
// ZIG-17 PR 4 Phase C/G: assemble durable packet, then complete_permit_packet.
// First-time incomplete remains PR 3 (job_status=needs_review).
// Stale-origin incomplete keeps job_status=needs_correction; run_status=needs_review.
// Ready fingerprint is RPC-owned. Live input TOCTOU skip is a Phase C seam:
// run_status=needs_review so the worker/queue does not treat the run as a
// successful handoff. Phase E owns rebuild enqueue. Phase G does not enqueue.
'use strict'

var {
  loadPacketRequirements,
  isPacketConfigValid,
  packetConfigMissingError,
} = require('../ahj/packet-config')
var {
  includedRequirements,
  assertKnownSourceTypes,
  loadCompany,
  loadJobDocuments,
  resolveIncludedRequirement,
} = require('../permits/packet-documents')
var { persistAssembledSubmissionPacket } = require('../permits/packet-assembly')
var {
  mergePacketJobSpecs,
  buildPacketDiagnostics,
  artifactEntry,
} = require('../permits/packet-job-specs')
var {
  upsertPendingPacketIncompleteReview,
  resolvePendingPacketIncompleteReviews,
} = require('../permits/packet-review')
var { buildStoredFingerprint } = require('../permits/packet-fingerprint')
var {
  toOrderedEntry,
  computeLiveInputFingerprint,
} = require('../permits/packet-fingerprint-adapter')
var {
  RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW,
} = require('./run-status.js')

var PERMIT_PACKET_RUN_TYPE = 'permit_packet'
var READY_STATUS = 'ready_for_physical_submission'
var PHYSICAL_SUBMISSION = 'physical_submission'
var JOB_STATUS_NEEDS_REVIEW = 'needs_review'
var JOB_STATUS_NEEDS_CORRECTION = 'needs_correction'
var REBUILD_REASON_PACKET_STALE = 'packet_stale'
var SKIPPED_READY_INPUT_CHANGED = 'packet_ready_skipped_input_changed'
var READY_FINGERPRINT_MISMATCH = 'ready_fingerprint_mismatch'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function runPayload(runRecord) {
  return isPlainObject(runRecord && runRecord.payload) ? runRecord.payload : {}
}

function packetStaleMarkerPresent(jobSpecs) {
  if (!isPlainObject(jobSpecs) || !isPlainObject(jobSpecs.packet)) return false
  if (!Object.prototype.hasOwnProperty.call(jobSpecs.packet, 'stale')) return false
  return jobSpecs.packet.stale != null
}

/**
 * Stale-origin rebuild from durable/run evidence only.
 * True when automation_runs.payload.rebuild_reason === packet_stale
 * or jobs.job_specs.packet.stale is present.
 * Do not infer from job_status = needs_correction.
 *
 * @param {object|null|undefined} runRecord
 * @param {object|null|undefined} jobSpecs
 * @returns {boolean}
 */
function isStalePacketRebuild(runRecord, jobSpecs) {
  if (runPayload(runRecord).rebuild_reason === REBUILD_REASON_PACKET_STALE) {
    return true
  }
  return packetStaleMarkerPresent(jobSpecs)
}

/**
 * Call the atomic DB RPC that sets job_status and ensures one pending action.
 * Worker-only. Never marks job_actions completed / never writes completed_by.
 * PR 3 does not invoke this. PR 4 owns the completion swap.
 *
 * @param {object} supabase — service-role client
 * @param {string} jobId
 * @returns {Promise<object>} RPC payload
 */
async function completePermitPacketSkeleton(supabase, jobId) {
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('completePermitPacketSkeleton: supabase client with rpc() is required')
  }
  if (!jobId) {
    throw new Error('completePermitPacketSkeleton: jobId is required')
  }

  var result = await supabase.rpc('complete_permit_packet_skeleton', {
    p_job_id: jobId,
  })

  if (result.error) {
    throw Object.assign(
      new Error('permit_packet atomic transition failed: ' + result.error.message),
      { errorCode: 'permit_packet_transition_failed', cause: result.error }
    )
  }

  var data = result.data
  if (!data || data.job_status !== READY_STATUS || !data.action_id) {
    throw new Error('permit_packet atomic transition returned unexpected payload')
  }

  return data
}

/**
 * Authoritative ready transition. Worker-only. Never writes completed_by.
 *
 * @param {object} supabase
 * @param {string} jobId
 * @param {object} fingerprint — Phase B stored envelope
 */
async function completePermitPacket(supabase, jobId, fingerprint) {
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('completePermitPacket: supabase client with rpc() is required')
  }
  if (!jobId) {
    throw new Error('completePermitPacket: jobId is required')
  }
  if (!fingerprint || typeof fingerprint !== 'object') {
    throw new Error('completePermitPacket: fingerprint is required')
  }

  var result = await supabase.rpc('complete_permit_packet', {
    p_job_id: jobId,
    p_fingerprint: fingerprint,
  })

  if (result.error) {
    throw Object.assign(
      new Error('permit_packet atomic transition failed: ' + result.error.message),
      { errorCode: 'permit_packet_transition_failed', cause: result.error }
    )
  }

  var data = result.data
  if (Array.isArray(data)) data = data[0]
  if (!data || data.ok !== true) {
    throw new Error('permit_packet atomic transition returned unexpected payload')
  }
  if (data.noop_reason === READY_FINGERPRINT_MISMATCH) {
    return data
  }
  if (data.job_status !== READY_STATUS || !data.action_id) {
    throw new Error('permit_packet atomic transition returned unexpected payload')
  }
  return data
}

/**
 * Assert AHJ packet requirements are present and valid (ZIG-10).
 * Throws packet_config_missing before any assembly.
 *
 * @param {object} supabase
 * @param {object} job
 */
async function assertPacketConfigForJob(supabase, job) {
  if (!job || !job.ahj_id) {
    throw packetConfigMissingError(job && job.ahj_id, 'job.ahj_id is required')
  }

  var requirements = await loadPacketRequirements(supabase, job.ahj_id)
  var validation = isPacketConfigValid(requirements)
  if (!validation.valid) {
    throw packetConfigMissingError(job.ahj_id, validation.reason || 'invalid packet configuration')
  }

  return requirements
}

async function readJobSpecs(supabase, jobId) {
  var result = await supabase.from('jobs').select('job_specs').eq('id', jobId).maybeSingle()
  if (result.error) {
    throw new Error('permit_packet job_specs lookup failed: ' + result.error.message)
  }
  return result.data && result.data.job_specs ? result.data.job_specs : {}
}

async function writeJobPacketDiagnostics(supabase, job, packet, jobStatus, existingSpecs) {
  var specs = existingSpecs !== undefined ? existingSpecs : await readJobSpecs(supabase, job.id)
  var payload = {
    job_specs: mergePacketJobSpecs(specs, packet),
    updated_at: new Date().toISOString(),
  }
  if (jobStatus) payload.job_status = jobStatus

  var update = await supabase.from('jobs').update(payload).eq('id', job.id)
  if (update.error) {
    throw new Error('permit_packet job update failed: ' + update.error.message)
  }
  return payload.job_specs
}

async function finalizeAutomationRun(supabase, runId, payload) {
  if (!runId) return
  var update = await supabase.from('automation_runs').update(payload).eq('id', runId)
  if (update.error) {
    throw new Error('permit_packet run finalize failed: ' + update.error.message)
  }
}

function toArtifact(requirement, resolved) {
  var document = resolved && resolved.document ? resolved.document : {}
  return artifactEntry({
    requirementId: requirement.id,
    documentId: document.id || null,
    documentRole: requirement.document_role,
    sourceType: requirement.source_type,
    filePath: document.file_path || null,
  })
}

/**
 * Permit packet run: config, completeness, deterministic assembly, persist,
 * then complete_permit_packet when live inputs still match the assembled fingerprint.
 *
 * @param {object} supabase
 * @param {object} job
 * @param {object} runRecord
 */
async function runPermitPacket(supabase, job, runRecord) {
  if (!job || !job.id) {
    throw new Error('runPermitPacket: job is required')
  }
  if (!job.company_id) {
    throw new Error('runPermitPacket: job.company_id is required (server-derived)')
  }

  var requirements = await assertPacketConfigForJob(supabase, job)
  var included = includedRequirements(requirements)
  assertKnownSourceTypes(included)

  var company = await loadCompany(supabase, job.company_id)
  var documents = await loadJobDocuments(supabase, job.id)
  var runId = runRecord && runRecord.id ? runRecord.id : null
  // Worker claim selects automation_runs.payload and passes the row through.
  // Phase G reads rebuild_reason from that payload; do not require a worker reshape.

  var completenessProblems = []
  var informationalProblems = []
  var resolvedArtifacts = []
  var mergeBytes = []
  var orderedEntries = []

  for (var i = 0; i < included.length; i++) {
    var requirement = included[i]
    var resolved = await resolveIncludedRequirement(
      supabase,
      job,
      company,
      requirement,
      documents
    )
    if (resolved.informational && resolved.informational.length) {
      informationalProblems = informationalProblems.concat(resolved.informational)
    }
    if (resolved.kind === 'incomplete') {
      completenessProblems = completenessProblems.concat(resolved.problems || [])
      continue
    }
    if (resolved.kind === 'skip') {
      continue
    }
    var orderedEntry = toOrderedEntry(job, requirement, resolved)
    orderedEntries.push(orderedEntry)
    resolvedArtifacts.push(toArtifact(requirement, resolved))
    mergeBytes.push(resolved.bytes)
    if (orderedEntry.artifact.bytes !== mergeBytes[mergeBytes.length - 1]) {
      throw new Error('permit_packet fingerprint ordering drifted from mergeBytes')
    }
  }

  var includedIds = included.map(function (row) {
    return row.id
  })
  var now = new Date().toISOString()

  if (!completenessProblems.length && !mergeBytes.length) {
    completenessProblems.push({
      code: 'empty_packet',
      message: 'No valid packet artifacts were resolved for submission.',
    })
  }

  if (completenessProblems.length) {
    var existingSpecs = await readJobSpecs(supabase, job.id)
    var staleOrigin =
      isStalePacketRebuild(runRecord, existingSpecs) ||
      isStalePacketRebuild(runRecord, job.job_specs)
    var incompleteJobStatus = staleOrigin
      ? JOB_STATUS_NEEDS_CORRECTION
      : JOB_STATUS_NEEDS_REVIEW
    var incompletePacket = buildPacketDiagnostics({
      complete: false,
      evaluatedAt: now,
      ahjId: job.ahj_id,
      includedRequirementIds: includedIds,
      problems: completenessProblems.concat(informationalProblems),
      generatedArtifacts: resolvedArtifacts,
      submissionPacket: null,
    })
    var incompleteSpecs = await writeJobPacketDiagnostics(
      supabase,
      job,
      incompletePacket,
      incompleteJobStatus,
      existingSpecs
    )
    await upsertPendingPacketIncompleteReview(supabase, job)
    await finalizeAutomationRun(supabase, runId, {
      run_status: RUN_STATUS_NEEDS_REVIEW,
      completed_at: now,
      last_completed_step: PERMIT_PACKET_RUN_TYPE,
      checkpoint_data: {
        packet_assembled: false,
        packet_complete: false,
      },
    })
    return {
      complete: false,
      jobId: job.id,
      companyId: job.company_id,
      jobStatus: incompleteJobStatus,
      jobSpecsPacket: incompleteSpecs.packet,
      submissionPacketDocumentId: null,
      filePath: null,
      completedBy: null,
      ready: false,
      skippedReadyReason: null,
      noopReason: null,
      fingerprint: null,
      orderedEntries: [],
    }
  }

  var assembled = await persistAssembledSubmissionPacket(supabase, job, mergeBytes)
  var fingerprint = buildStoredFingerprint({
    orderedEntries: orderedEntries,
    submissionPacketBytes: assembled.bytes,
    computedAt: now,
  })
  var completePacket = buildPacketDiagnostics({
    complete: true,
    evaluatedAt: now,
    ahjId: job.ahj_id,
    includedRequirementIds: includedIds,
    problems: informationalProblems,
    generatedArtifacts: resolvedArtifacts,
    submissionPacket: {
      document_id: assembled.documentId,
      file_path: assembled.filePath,
      file_name: assembled.fileName,
    },
  })
  var completeSpecs = await writeJobPacketDiagnostics(supabase, job, completePacket, null)
  await resolvePendingPacketIncompleteReviews(supabase, job.id)

  var live = await computeLiveInputFingerprint(supabase, job)
  var skippedReadyReason = null
  var rpcPayload = null
  if (!live.ok || live.inputFingerprint !== fingerprint.input_fingerprint) {
    // Phase C seam: inputs moved after assembly. Do not ready. Phase E enqueues rebuilds.
    skippedReadyReason = SKIPPED_READY_INPUT_CHANGED
  } else {
    rpcPayload = await completePermitPacket(supabase, job.id, fingerprint)
    if (rpcPayload.noop_reason === READY_FINGERPRINT_MISMATCH) {
      skippedReadyReason = READY_FINGERPRINT_MISMATCH
    }
  }

  var readyWon =
    rpcPayload &&
    rpcPayload.job_status === READY_STATUS &&
    rpcPayload.action_id &&
    rpcPayload.noop_reason !== READY_FINGERPRINT_MISMATCH

  // TOCTOU skip is not a successful handoff. needs_review is an existing
  // paused/follow-up status (unique active permit_packet index is queued|running
  // only; complete would look like the packet step succeeded). Phase E enqueues.
  // Phase G does not write job_status here: stale-origin jobs stay needs_correction.
  var runStatus =
    skippedReadyReason === SKIPPED_READY_INPUT_CHANGED
      ? RUN_STATUS_NEEDS_REVIEW
      : RUN_STATUS_COMPLETE

  await finalizeAutomationRun(supabase, runId, {
    run_status: runStatus,
    completed_at: now,
    last_completed_step: PERMIT_PACKET_RUN_TYPE,
    checkpoint_data: {
      packet_assembled: true,
      document_id: assembled.documentId,
      file_path: assembled.filePath,
      input_fingerprint: fingerprint.input_fingerprint,
      content_fingerprint: fingerprint.content_fingerprint,
      ready: readyWon === true,
      skipped_ready_reason: skippedReadyReason,
    },
  })

  return {
    complete: true,
    ready: readyWon === true,
    skippedReadyReason: skippedReadyReason,
    noopReason: rpcPayload && rpcPayload.noop_reason ? rpcPayload.noop_reason : null,
    jobId: job.id,
    companyId: job.company_id,
    submissionPacketDocumentId: assembled.documentId,
    filePath: assembled.filePath,
    jobSpecsPacket: completeSpecs.packet,
    jobStatus: readyWon ? READY_STATUS : rpcPayload ? rpcPayload.job_status : null,
    actionId: readyWon ? rpcPayload.action_id : null,
    actionCreated: readyWon ? rpcPayload.action_created === true : false,
    fingerprint: fingerprint,
    orderedEntries: orderedEntries,
    completedBy: null,
  }
}

/**
 * Static guard used by tests: worker packet module must not expose completion.
 */
function workerCanCompleteJobAction() {
  return false
}

module.exports = {
  PERMIT_PACKET_RUN_TYPE: PERMIT_PACKET_RUN_TYPE,
  READY_FOR_PHYSICAL_SUBMISSION: READY_STATUS,
  PHYSICAL_SUBMISSION_ACTION_TYPE: PHYSICAL_SUBMISSION,
  RUN_STATUS_COMPLETE: RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW: RUN_STATUS_NEEDS_REVIEW,
  JOB_STATUS_NEEDS_REVIEW: JOB_STATUS_NEEDS_REVIEW,
  JOB_STATUS_NEEDS_CORRECTION: JOB_STATUS_NEEDS_CORRECTION,
  REBUILD_REASON_PACKET_STALE: REBUILD_REASON_PACKET_STALE,
  SKIPPED_READY_INPUT_CHANGED: SKIPPED_READY_INPUT_CHANGED,
  READY_FINGERPRINT_MISMATCH: READY_FINGERPRINT_MISMATCH,
  isStalePacketRebuild: isStalePacketRebuild,
  completePermitPacketSkeleton: completePermitPacketSkeleton,
  completePermitPacket: completePermitPacket,
  assertPacketConfigForJob: assertPacketConfigForJob,
  runPermitPacket: runPermitPacket,
  runPermitPacketSkeleton: runPermitPacket,
  workerCanCompleteJobAction: workerCanCompleteJobAction,
}
