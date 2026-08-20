// lib/permits/packet-fingerprint-adapter.js
// ZIG-17 PR 4 Phase C: map PR 3 resolve output onto Phase B orderedEntries.
// Does not sort. Does not re-resolve assembled fingerprints from job/company.
// Live TOCTOU uses resolveLiveFingerprintRequirement (no dart regenerate).
'use strict'

var {
  loadPacketRequirements,
} = require('../ahj/packet-config')
var {
  includedRequirements,
  loadCompany,
  loadJobDocuments,
  resolveLiveFingerprintRequirement,
} = require('./packet-documents')
var { inputFingerprint } = require('./packet-fingerprint')

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Collapse resolveFieldValues().values[] into { [sourcePath]: value|null }.
 * First occurrence of a source path wins. Missing/skipped → null.
 * Extra keys are not invented here; unused job/company fields never appear.
 *
 * @param {object[]|null|undefined} fieldValues
 * @returns {Object<string, string|number|boolean|null>}
 */
function resolvedValuesFromFieldValues(fieldValues) {
  var map = {}
  if (!Array.isArray(fieldValues)) return map
  for (var i = 0; i < fieldValues.length; i++) {
    var row = fieldValues[i]
    if (!row || typeof row.source !== 'string' || row.source === '') continue
    if (Object.prototype.hasOwnProperty.call(map, row.source)) continue
    map[row.source] = row.hasValue === true ? row.value : null
  }
  return map
}

function fingerprintRequirement(requirement, parsedFieldMap) {
  return {
    id: requirement.id,
    ahj_id: requirement.ahj_id,
    sort_order: requirement.sort_order,
    document_role: requirement.document_role,
    source_type: requirement.source_type,
    required: requirement.required,
    include_in_submission_packet: requirement.include_in_submission_packet,
    template_storage_path: requirement.template_storage_path,
    field_map: parsedFieldMap == null ? null : parsedFieldMap,
  }
}

/**
 * Build one merge participant. Caller must push resolved.bytes to mergeBytes
 * in the same iteration so artifact.bytes === mergeBytes[i] by reference.
 *
 * @param {object} job
 * @param {object} requirement
 * @param {object} resolved — resolveIncludedRequirement / live resolver found result
 */
function toOrderedEntry(job, requirement, resolved) {
  var document = resolved && resolved.document ? resolved.document : {}
  var parsedFieldMap = resolved && resolved.parsedFieldMap != null ? resolved.parsedFieldMap : null
  var hasFieldMap = parsedFieldMap != null && isPlainObject(parsedFieldMap)
  return {
    ahjId: (job && job.ahj_id) || requirement.ahj_id,
    requirement: fingerprintRequirement(requirement, hasFieldMap ? parsedFieldMap : null),
    resolvedValues: hasFieldMap
      ? resolvedValuesFromFieldValues(resolved.fieldValues)
      : {},
    artifact: {
      documentId: document.id,
      documentType: document.document_type,
      filePath: document.file_path,
      bytes: resolved.bytes,
    },
  }
}

async function loadLiveJob(supabase, jobId) {
  var result = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (result.error) {
    throw new Error('permit_packet live job lookup failed: ' + result.error.message)
  }
  if (!result.data || !result.data.id) {
    throw new Error('permit_packet live job not found: ' + jobId)
  }
  return result.data
}

/**
 * Recompute current effective input fingerprint from live DB/Storage.
 * Phase C seam: if this differs from the assembled fingerprint, skip ready RPC.
 * Does not enqueue a rebuild (Phase E).
 *
 * @returns {Promise<{ ok: boolean, inputFingerprint?: string, reason?: string }>}
 */
async function computeLiveInputFingerprint(supabase, job) {
  var liveJob = await loadLiveJob(supabase, job.id)
  var liveCompany = await loadCompany(supabase, liveJob.company_id || job.company_id)
  var requirements = await loadPacketRequirements(supabase, liveJob.ahj_id || job.ahj_id)
  var included = includedRequirements(requirements)
  var documents = await loadJobDocuments(supabase, liveJob.id)
  var orderedEntries = []

  for (var i = 0; i < included.length; i++) {
    var requirement = included[i]
    var resolved = await resolveLiveFingerprintRequirement(
      supabase,
      liveJob,
      liveCompany,
      requirement,
      documents
    )
    if (resolved.kind === 'incomplete') {
      return { ok: false, reason: 'live_incomplete' }
    }
    if (resolved.kind === 'skip') continue
    orderedEntries.push(toOrderedEntry(liveJob, requirement, resolved))
  }

  if (!orderedEntries.length) {
    return { ok: false, reason: 'live_empty' }
  }

  return {
    ok: true,
    inputFingerprint: inputFingerprint(orderedEntries),
    orderedEntries: orderedEntries,
  }
}

module.exports = {
  resolvedValuesFromFieldValues: resolvedValuesFromFieldValues,
  toOrderedEntry: toOrderedEntry,
  computeLiveInputFingerprint: computeLiveInputFingerprint,
}
