// lib/permits/packet-job-specs.js
// ZIG-17 PR 3: versioned jobs.job_specs.packet merge. Canonical truth is job_documents.
'use strict'

var PACKET_DIAGNOSTICS_VERSION = 1

function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.assign({}, value)
}

function mergePacketJobSpecs(existingSpecs, packet) {
  var specs = clonePlainObject(existingSpecs)
  specs.packet = packet
  return specs
}

function buildPacketDiagnostics(input) {
  var data = input || {}
  return {
    version: PACKET_DIAGNOSTICS_VERSION,
    complete: data.complete === true,
    evaluated_at: data.evaluatedAt || new Date().toISOString(),
    ahj_id: data.ahjId || null,
    included_requirement_ids: Array.isArray(data.includedRequirementIds)
      ? data.includedRequirementIds.slice()
      : [],
    problems: Array.isArray(data.problems) ? data.problems.slice() : [],
    artifacts: {
      generated: Array.isArray(data.generatedArtifacts)
        ? data.generatedArtifacts.slice()
        : [],
      submission_packet: data.submissionPacket || null,
    },
  }
}

function artifactEntry(input) {
  var data = input || {}
  return {
    requirement_id: data.requirementId || null,
    document_id: data.documentId || null,
    document_role: data.documentRole || null,
    source_type: data.sourceType || null,
    file_path: data.filePath || null,
  }
}

module.exports = {
  PACKET_DIAGNOSTICS_VERSION: PACKET_DIAGNOSTICS_VERSION,
  mergePacketJobSpecs: mergePacketJobSpecs,
  buildPacketDiagnostics: buildPacketDiagnostics,
  artifactEntry: artifactEntry,
}
