// lib/automation/permit-packet.js
// ZIG-17 PR 3: permit_packet execution — config, completeness, assembly, persist.
// Does not call complete_permit_packet_skeleton and does not set
// ready_for_physical_submission. PR 4 owns that handoff.
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

var PERMIT_PACKET_RUN_TYPE = 'permit_packet'
var READY_STATUS = 'ready_for_physical_submission'
var PHYSICAL_SUBMISSION = 'physical_submission'
var RUN_STATUS_COMPLETE = 'complete'
var RUN_STATUS_NEEDS_REVIEW = 'needs_review'

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

async function writeJobPacketDiagnostics(supabase, job, packet, jobStatus) {
  var existingSpecs = await readJobSpecs(supabase, job.id)
  var payload = {
    job_specs: mergePacketJobSpecs(existingSpecs, packet),
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
 * Permit packet run: config, completeness, deterministic assembly, persist.
 * Does not transition to ready_for_physical_submission.
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

  var completenessProblems = []
  var informationalProblems = []
  var resolvedArtifacts = []
  var mergeBytes = []

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
    resolvedArtifacts.push(toArtifact(requirement, resolved))
    mergeBytes.push(resolved.bytes)
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
      'needs_review'
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
      jobStatus: 'needs_review',
      jobSpecsPacket: incompleteSpecs.packet,
      submissionPacketDocumentId: null,
      filePath: null,
      completedBy: null,
    }
  }

  var assembled = await persistAssembledSubmissionPacket(supabase, job, mergeBytes)
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
  await finalizeAutomationRun(supabase, runId, {
    run_status: RUN_STATUS_COMPLETE,
    completed_at: now,
    last_completed_step: PERMIT_PACKET_RUN_TYPE,
    checkpoint_data: {
      packet_assembled: true,
      document_id: assembled.documentId,
      file_path: assembled.filePath,
    },
  })

  return {
    complete: true,
    jobId: job.id,
    companyId: job.company_id,
    submissionPacketDocumentId: assembled.documentId,
    filePath: assembled.filePath,
    jobSpecsPacket: completeSpecs.packet,
    jobStatus: null,
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
  completePermitPacketSkeleton: completePermitPacketSkeleton,
  assertPacketConfigForJob: assertPacketConfigForJob,
  runPermitPacket: runPermitPacket,
  runPermitPacketSkeleton: runPermitPacket,
  workerCanCompleteJobAction: workerCanCompleteJobAction,
}
