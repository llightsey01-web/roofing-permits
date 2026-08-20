// lib/permits/packet-documents.js
// ZIG-17 PR 3: requirement resolution, dart_generated fill, canonical persist.
'use strict'

var { PDFDocument } = require('pdf-lib')
var {
  parseCanonicalFieldMap,
  validateFieldMapAgainstPdf,
  resolveFieldValues,
  applyResolvedFields,
  packetConfigInvalidError,
  KIND,
} = require('./packet-field-map')
var {
  documentTypesForRole,
  coarseDocumentTypeForGeneratedRole,
} = require('./packet-document-type')
var { isUniqueViolation } = require('../documents/upsert-canonical-job-document')

var STORAGE_BUCKET = 'job-documents'
var KNOWN_SOURCE_TYPES = Object.freeze({
  dart_generated: true,
  contractor_uploaded: true,
  human_obtained: true,
})

function programmerError(message) {
  return Object.assign(new Error(message), {
    errorCode: 'packet_document_programmer_error',
  })
}

function writeError(message, cause) {
  return Object.assign(new Error(message), {
    errorCode: 'packet_document_write_failed',
    cause: cause || null,
  })
}

function identityConflictError(input) {
  var data = input || {}
  var candidateIds = Array.isArray(data.candidateDocumentIds)
    ? data.candidateDocumentIds.slice()
    : []
  return Object.assign(
    new Error(
      'canonical job_documents identity conflict for ' +
        String(data.identityKind || 'unknown') +
        ': ' +
        candidateIds.length +
        ' rows'
    ),
    {
      errorCode: 'packet_document_identity_conflict',
      nonRetryable: true,
      identity_kind: data.identityKind || null,
      job_id: data.jobId || null,
      requirement_id: data.requirementId || null,
      document_type: data.documentType || null,
      candidate_document_ids: candidateIds,
    }
  )
}

function makeProblem(code, extra) {
  var problem = { code: code }
  if (extra) {
    Object.keys(extra).forEach(function (key) {
      problem[key] = extra[key]
    })
  }
  if (!problem.message) problem.message = code
  return problem
}

function requirementMeta(requirement) {
  return {
    requirement_id: requirement && requirement.id ? requirement.id : null,
    document_role: requirement && requirement.document_role ? requirement.document_role : null,
    display_name: requirement && requirement.display_name ? requirement.display_name : null,
    source_type: requirement && requirement.source_type ? requirement.source_type : null,
  }
}

function includedRequirements(requirements) {
  return (requirements || []).filter(function (row) {
    return row && row.include_in_submission_packet === true
  })
}

function assertKnownSourceTypes(requirements) {
  ;(requirements || []).forEach(function (row) {
    var sourceType = row && row.source_type
    if (!KNOWN_SOURCE_TYPES[sourceType]) {
      throw packetConfigInvalidError(
        'unsupported source_type "' + String(sourceType) + '"',
        [
          makeProblem('unsupported_source_type', {
            requirement_id: row && row.id,
            document_role: row && row.document_role,
            source_type: sourceType || null,
            message: 'unsupported source_type "' + String(sourceType) + '"',
          }),
        ]
      )
    }
  })
}

function generatedStoragePath(jobId, requirementId, documentRole) {
  return (
    'jobs/' +
    jobId +
    '/generated/' +
    requirementId +
    '/' +
    String(documentRole || 'document') +
    '.pdf'
  )
}

function submissionPacketStoragePath(jobId) {
  return 'jobs/' + jobId + '/generated/submission-packet.pdf'
}

async function loadCompany(supabase, companyId) {
  if (!companyId) return null
  var result = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
  if (result.error) {
    throw writeError('company lookup failed: ' + result.error.message, result.error)
  }
  return result.data || null
}

async function loadJobDocuments(supabase, jobId) {
  var result = await supabase.from('job_documents').select('*').eq('job_id', jobId)
  if (result.error) {
    throw writeError('job_documents lookup failed: ' + result.error.message, result.error)
  }
  return result.data || []
}

async function downloadStorageBytes(supabase, filePath) {
  var download = await supabase.storage.from(STORAGE_BUCKET).download(filePath)
  if (download.error || !download.data) {
    return {
      ok: false,
      error: download.error || { message: 'empty download' },
    }
  }
  var bytes = Buffer.from(await download.data.arrayBuffer())
  return { ok: true, bytes: bytes }
}

async function uploadStorageBytes(supabase, filePath, pdfBytes) {
  var upload = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (upload.error) {
    throw writeError('storage upload failed: ' + upload.error.message, upload.error)
  }
  return { filePath: filePath }
}

async function isLoadablePdf(pdfBytes) {
  try {
    await PDFDocument.load(pdfBytes)
    return true
  } catch (err) {
    return false
  }
}

function boundDocuments(documents, requirementId) {
  return (documents || []).filter(function (doc) {
    return doc && doc.ahj_document_requirement_id === requirementId
  })
}

function legacyDocumentsForRole(documents, documentRole) {
  var types = documentTypesForRole(documentRole)
  return (documents || []).filter(function (doc) {
    if (!doc || doc.ahj_document_requirement_id) return false
    return types.indexOf(doc.document_type) !== -1
  })
}

/**
 * Resolve a contractor_uploaded / human_obtained artifact without binding.
 * @returns {{ kind: 'found'|'missing'|'skip'|'ambiguous', document?: object, problem?: object }}
 */
function resolveExistingRequirementDocument(requirement, documents) {
  var bound = boundDocuments(documents, requirement.id)
  if (bound.length === 1) {
    return { kind: 'found', document: bound[0], bound: true }
  }
  if (bound.length > 1) {
    return {
      kind: 'ambiguous',
      problem: makeProblem('ambiguous_legacy_document', Object.assign(requirementMeta(requirement), {
        candidate_document_ids: bound.map(function (doc) { return doc.id }),
        message:
          'multiple requirement-bound documents for document_role=' +
          String(requirement.document_role),
      })),
    }
  }

  var legacy = legacyDocumentsForRole(documents, requirement.document_role)
  if (legacy.length === 1) {
    return { kind: 'found', document: legacy[0], bound: false }
  }
  if (legacy.length > 1) {
    return {
      kind: 'ambiguous',
      problem: makeProblem('ambiguous_legacy_document', Object.assign(requirementMeta(requirement), {
        candidate_document_ids: legacy.map(function (doc) { return doc.id }),
        message:
          'multiple legacy documents for document_role=' +
          String(requirement.document_role),
      })),
    }
  }

  if (requirement.required === true) {
    return {
      kind: 'missing',
      problem: makeProblem('required_document_missing', Object.assign(requirementMeta(requirement), {
        message:
          'required document missing for document_role=' +
          String(requirement.document_role),
      })),
    }
  }

  return {
    kind: 'skip',
    problem: makeProblem('optional_document_missing', Object.assign(requirementMeta(requirement), {
      message:
        'optional document missing for document_role=' +
        String(requirement.document_role),
    })),
  }
}

function rowIds(rows) {
  return (rows || []).map(function (row) {
    return row && row.id
  })
}

async function updateCanonicalRowById(supabase, rowId, payload) {
  var update = await supabase.from('job_documents').update(payload).eq('id', rowId)
  if (update.error) {
    throw writeError(
      'canonical job_documents update failed: ' + update.error.message,
      update.error
    )
  }
  return { id: rowId, reused: true, alignedRows: 1 }
}

async function persistCanonicalRow(supabase, lookup, insertRow, payload, identity) {
  var ident = identity || {}
  var existing = await lookup()
  if (existing.error) {
    throw writeError(
      'canonical job_documents lookup failed: ' + existing.error.message,
      existing.error
    )
  }
  var rows = existing.data || []
  if (rows.length > 1) {
    throw identityConflictError({
      identityKind: ident.identityKind,
      jobId: ident.jobId,
      requirementId: ident.requirementId,
      documentType: ident.documentType,
      candidateDocumentIds: rowIds(rows),
    })
  }
  if (rows.length === 1) {
    return updateCanonicalRowById(supabase, rows[0].id, payload)
  }

  var insert = await supabase
    .from('job_documents')
    .insert(insertRow)
    .select('id')
    .single()

  if (!insert.error) {
    return {
      id: insert.data && insert.data.id,
      reused: false,
      alignedRows: 1,
    }
  }

  if (!isUniqueViolation(insert.error)) {
    throw writeError(
      'canonical job_documents insert failed: ' + insert.error.message,
      insert.error
    )
  }

  var retry = await lookup()
  if (retry.error) {
    throw writeError(
      'canonical job_documents uniqueness retry lookup failed: ' + retry.error.message,
      retry.error
    )
  }
  var retryRows = retry.data || []
  if (retryRows.length === 1) {
    var raced = await updateCanonicalRowById(supabase, retryRows[0].id, payload)
    raced.raced = true
    return raced
  }
  if (retryRows.length > 1) {
    throw identityConflictError({
      identityKind: ident.identityKind,
      jobId: ident.jobId,
      requirementId: ident.requirementId,
      documentType: ident.documentType,
      candidateDocumentIds: rowIds(retryRows),
    })
  }

  throw writeError(
    'canonical job_documents unique violation but no winning row found: ' +
      insert.error.message,
    insert.error
  )
}

async function evaluateAfterDocumentWrite(supabase, jobId, skipPacketFreshness) {
  var freshness = require('./packet-freshness')
  return freshness.evaluatePacketFreshnessAfterMutation(jobId, supabase, {
    skipPacketFreshness: skipPacketFreshness === true,
  })
}

async function persistRequirementBackedJobDocument(supabase, input) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw programmerError('persistRequirementBackedJobDocument: supabase client is required')
  }
  var jobId = input && input.jobId
  var requirementId = input && input.requirementId
  var documentType = input && input.documentType
  var fileName = input && input.fileName
  var filePath = input && input.filePath
  if (!jobId || !requirementId || !documentType || !fileName || !filePath) {
    throw programmerError(
      'persistRequirementBackedJobDocument: jobId, requirementId, documentType, fileName, and filePath are required'
    )
  }

  var payload = {
    file_name: fileName,
    file_path: filePath,
    mime_type: input.mimeType || 'application/pdf',
    uploaded_at: new Date().toISOString(),
    ahj_document_requirement_id: requirementId,
  }
  if (input.fileSizeBytes != null) payload.file_size_bytes = input.fileSizeBytes

  function lookup() {
    return supabase
      .from('job_documents')
      .select('id')
      .eq('job_id', jobId)
      .eq('ahj_document_requirement_id', requirementId)
      .order('uploaded_at', { ascending: true })
  }

  var insertRow = Object.assign(
    {
      job_id: jobId,
      document_type: documentType,
    },
    payload
  )

  var persisted = await persistCanonicalRow(supabase, lookup, insertRow, payload, {
    identityKind: 'requirement',
    jobId: jobId,
    requirementId: requirementId,
    documentType: documentType,
  })
  persisted.freshness = await evaluateAfterDocumentWrite(
    supabase,
    jobId,
    input.skipPacketFreshness === true
  )
  return persisted
}

async function persistSubmissionPacketDocument(supabase, input) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw programmerError('persistSubmissionPacketDocument: supabase client is required')
  }
  var jobId = input && input.jobId
  var fileName = input && input.fileName
  var filePath = input && input.filePath
  if (!jobId || !fileName || !filePath) {
    throw programmerError(
      'persistSubmissionPacketDocument: jobId, fileName, and filePath are required'
    )
  }

  var payload = {
    file_name: fileName,
    file_path: filePath,
    mime_type: input.mimeType || 'application/pdf',
    uploaded_at: new Date().toISOString(),
  }
  if (input.fileSizeBytes != null) payload.file_size_bytes = input.fileSizeBytes

  function lookup() {
    return supabase
      .from('job_documents')
      .select('id')
      .eq('job_id', jobId)
      .eq('document_type', 'submission_packet')
      .order('uploaded_at', { ascending: true })
  }

  var insertRow = Object.assign(
    {
      job_id: jobId,
      document_type: 'submission_packet',
    },
    payload
  )

  var persisted = await persistCanonicalRow(supabase, lookup, insertRow, payload, {
    identityKind: 'submission_packet',
    jobId: jobId,
    documentType: 'submission_packet',
  })
  persisted.freshness = await evaluateAfterDocumentWrite(
    supabase,
    jobId,
    input.skipPacketFreshness === true
  )
  return persisted
}

function attachFieldProblems(requirement, fieldProblems) {
  return (fieldProblems || []).map(function (problem) {
    return Object.assign({}, requirementMeta(requirement), problem)
  })
}

async function generateDartRequirementPdf(supabase, job, company, requirement) {
  var documentType = coarseDocumentTypeForGeneratedRole(requirement.document_role)
  var templatePath = requirement.template_storage_path
  if (!templatePath || !String(templatePath).trim()) {
    throw packetConfigInvalidError(
      'dart_generated row missing template_storage_path for document_role=' +
        String(requirement.document_role),
      [
        makeProblem('template_storage_path_missing', Object.assign(requirementMeta(requirement), {
          message: 'dart_generated row missing template_storage_path',
        })),
      ]
    )
  }

  var downloaded = await downloadStorageBytes(supabase, templatePath)
  if (!downloaded.ok) {
    throw packetConfigInvalidError(
      'configured template is missing for document_role=' +
        String(requirement.document_role),
      [
        makeProblem(
          'template_storage_missing',
          Object.assign(requirementMeta(requirement), {
            template_storage_path: templatePath,
            message:
              'configured template could not be downloaded from template_storage_path',
          })
        ),
      ]
    )
  }

  var parsedMap = parseCanonicalFieldMap(requirement.field_map)
  await validateFieldMapAgainstPdf(downloaded.bytes, parsedMap)
  var resolved = resolveFieldValues(parsedMap, { job: job, company: company })
  if (resolved.kind === KIND.CONFIG) {
    throw packetConfigInvalidError(
      'field_map config invalid for document_role=' + String(requirement.document_role),
      attachFieldProblems(requirement, resolved.problems.config)
    )
  }
  if (resolved.kind === KIND.INCOMPLETE) {
    return {
      kind: 'incomplete',
      problems: attachFieldProblems(requirement, resolved.problems.completeness),
      informational: attachFieldProblems(requirement, resolved.problems.informational),
    }
  }

  var doc = await PDFDocument.load(downloaded.bytes)
  applyResolvedFields(doc.getForm(), resolved.values)
  doc.getForm().flatten()
  var pdfBytes = Buffer.from(await doc.save())
  if (!(await isLoadablePdf(pdfBytes))) {
    return {
      kind: 'incomplete',
      problems: [
        makeProblem('invalid_pdf', Object.assign(requirementMeta(requirement), {
          message: 'generated PDF failed to reload for document_role=' + String(requirement.document_role),
        })),
      ],
      informational: attachFieldProblems(requirement, resolved.problems.informational),
    }
  }

  var filePath = generatedStoragePath(job.id, requirement.id, requirement.document_role)
  await uploadStorageBytes(supabase, filePath, pdfBytes)
  var persisted = await persistRequirementBackedJobDocument(supabase, {
    jobId: job.id,
    requirementId: requirement.id,
    documentType: documentType,
    fileName: (requirement.display_name || requirement.document_role) + '.pdf',
    filePath: filePath,
    fileSizeBytes: pdfBytes.length,
    mimeType: 'application/pdf',
    skipPacketFreshness: true,
  })

  return {
    kind: 'found',
    bytes: pdfBytes,
    document: {
      id: persisted.id,
      file_path: filePath,
      document_type: documentType,
      ahj_document_requirement_id: requirement.id,
    },
    reused: persisted.reused === true,
    informational: attachFieldProblems(requirement, resolved.problems.informational),
    fieldValues: resolved.values,
    parsedFieldMap: parsedMap,
  }
}

async function loadResolvedPdfBytes(supabase, requirement, document) {
  if (!document || !document.file_path) {
    if (requirement.required === true) {
      return {
        kind: 'incomplete',
        problem: makeProblem('required_document_missing', Object.assign(requirementMeta(requirement), {
          message: 'resolved document is missing file_path',
        })),
      }
    }
    return {
      kind: 'skip',
      problem: makeProblem('optional_document_missing', Object.assign(requirementMeta(requirement), {
        message: 'optional document is missing file_path',
      })),
    }
  }

  var downloaded = await downloadStorageBytes(supabase, document.file_path)
  if (!downloaded.ok) {
    var loadProblem = makeProblem('invalid_pdf', Object.assign(requirementMeta(requirement), {
      document_id: document.id || null,
      file_path: document.file_path,
      message:
        'failed to download artifact for document_role=' +
        String(requirement.document_role),
    }))
    if (requirement.required === true) {
      return { kind: 'incomplete', problem: loadProblem }
    }
    return { kind: 'skip', problem: loadProblem }
  }

  if (!(await isLoadablePdf(downloaded.bytes))) {
    var invalid = makeProblem('invalid_pdf', Object.assign(requirementMeta(requirement), {
      document_id: document.id || null,
      file_path: document.file_path,
      message:
        'artifact is not a loadable PDF for document_role=' +
        String(requirement.document_role),
    }))
    if (requirement.required === true) {
      return { kind: 'incomplete', problem: invalid }
    }
    return { kind: 'skip', problem: invalid }
  }

  return { kind: 'found', bytes: downloaded.bytes, document: document }
}

/**
 * Resolve one included requirement to mergeable PDF bytes or a problem.
 */
async function resolveIncludedRequirement(supabase, job, company, requirement, documents) {
  if (requirement.source_type === 'dart_generated') {
    return generateDartRequirementPdf(supabase, job, company, requirement)
  }

  var resolved = resolveExistingRequirementDocument(requirement, documents)
  if (resolved.kind === 'ambiguous' || resolved.kind === 'missing') {
    return { kind: 'incomplete', problems: [resolved.problem] }
  }
  if (resolved.kind === 'skip') {
    return { kind: 'skip', informational: [resolved.problem] }
  }

  var loaded = await loadResolvedPdfBytes(supabase, requirement, resolved.document)
  if (loaded.kind === 'incomplete') {
    return { kind: 'incomplete', problems: [loaded.problem] }
  }
  if (loaded.kind === 'skip') {
    return { kind: 'skip', informational: [loaded.problem] }
  }
  return {
    kind: 'found',
    bytes: loaded.bytes,
    document: loaded.document,
    informational: [],
  }
}

/**
 * Live fingerprint resolution: same include/skip/incomplete rules as assembly,
 * but dart_generated is not regenerated (avoids pdf-lib byte drift). Field values
 * are re-resolved from live job/company; artifact bytes are the current durable file.
 */
async function resolveLiveFingerprintRequirement(supabase, job, company, requirement, documents) {
  if (requirement.source_type === 'dart_generated') {
    var parsedMap = parseCanonicalFieldMap(requirement.field_map)
    var resolved = resolveFieldValues(parsedMap, { job: job, company: company })
    if (resolved.kind === KIND.CONFIG) {
      throw packetConfigInvalidError(
        'field_map config invalid for document_role=' + String(requirement.document_role),
        attachFieldProblems(requirement, resolved.problems.config)
      )
    }
    if (resolved.kind === KIND.INCOMPLETE) {
      return {
        kind: 'incomplete',
        problems: attachFieldProblems(requirement, resolved.problems.completeness),
        informational: attachFieldProblems(requirement, resolved.problems.informational),
        fieldValues: resolved.values,
        parsedFieldMap: parsedMap,
      }
    }
    var existing = resolveExistingRequirementDocument(requirement, documents)
    if (existing.kind === 'ambiguous' || existing.kind === 'missing') {
      return { kind: 'incomplete', problems: [existing.problem] }
    }
    if (existing.kind === 'skip') {
      return { kind: 'skip', informational: [existing.problem] }
    }
    var loaded = await loadResolvedPdfBytes(supabase, requirement, existing.document)
    if (loaded.kind === 'incomplete') {
      return { kind: 'incomplete', problems: [loaded.problem] }
    }
    if (loaded.kind === 'skip') {
      return { kind: 'skip', informational: [loaded.problem] }
    }
    return {
      kind: 'found',
      bytes: loaded.bytes,
      document: loaded.document,
      informational: attachFieldProblems(requirement, resolved.problems.informational),
      fieldValues: resolved.values,
      parsedFieldMap: parsedMap,
    }
  }

  return resolveIncludedRequirement(supabase, job, company, requirement, documents)
}

module.exports = {
  STORAGE_BUCKET: STORAGE_BUCKET,
  KNOWN_SOURCE_TYPES: KNOWN_SOURCE_TYPES,
  includedRequirements: includedRequirements,
  assertKnownSourceTypes: assertKnownSourceTypes,
  generatedStoragePath: generatedStoragePath,
  submissionPacketStoragePath: submissionPacketStoragePath,
  loadCompany: loadCompany,
  loadJobDocuments: loadJobDocuments,
  isLoadablePdf: isLoadablePdf,
  resolveExistingRequirementDocument: resolveExistingRequirementDocument,
  persistRequirementBackedJobDocument: persistRequirementBackedJobDocument,
  persistSubmissionPacketDocument: persistSubmissionPacketDocument,
  identityConflictError: identityConflictError,
  resolveIncludedRequirement: resolveIncludedRequirement,
  resolveLiveFingerprintRequirement: resolveLiveFingerprintRequirement,
  uploadStorageBytes: uploadStorageBytes,
  downloadStorageBytes: downloadStorageBytes,
  makeProblem: makeProblem,
}
