/**
 * Server-side canonical job_documents upsert for the four NOC types.
 * Identity is (job_id, document_type). ahj_document_requirement_id stays null.
 *
 * DB enforces that pair via partial unique index
 * job_documents_job_id_noc_document_type_uidx.
 *
 * Concurrent first-insert: one insert wins; the loser gets unique_violation
 * (Postgres 23505). Only that class of insert error re-queries and reuses
 * the winning row. Other insert errors propagate.
 */
'use strict'

var CANONICAL_NOC_DOCUMENT_TYPE_LIST = [
  'notice_of_commencement',
  'noc_uploaded_signed',
  'noc_uploaded_notarized',
  'noc_uploaded_recorded',
]
var CANONICAL_NOC_DOCUMENT_TYPES = CANONICAL_NOC_DOCUMENT_TYPE_LIST.reduce(function (acc, label) {
  acc[label] = true
  return acc
}, {})

function programmerError(message) {
  return Object.assign(new Error(message), {
    errorCode: 'canonical_document_programmer_error',
  })
}

function writeError(message, cause) {
  return Object.assign(new Error(message), {
    errorCode: 'canonical_document_write_failed',
    cause: cause || null,
  })
}

/**
 * True only for uniqueness collisions (Postgres 23505 / PostgREST 409 unique).
 * Other insert failures must not enter the reuse path.
 */
function isUniqueViolation(error) {
  if (!error) return false
  var code = error.code != null ? String(error.code) : ''
  var message = error.message != null ? String(error.message) : ''
  if (code === '23505') return true
  if (code === '409' && /unique|duplicate key/i.test(message)) return true
  return /duplicate key value violates unique constraint/i.test(message)
}

function listExisting(supabase, jobId, documentType) {
  return supabase
    .from('job_documents')
    .select('id')
    .eq('job_id', jobId)
    .eq('document_type', documentType)
    .order('uploaded_at', { ascending: true })
}

function buildPayload(input) {
  var payload = {
    file_name: input.fileName,
    file_path: input.filePath,
    mime_type: input.mimeType || 'application/pdf',
    uploaded_at: new Date().toISOString(),
  }
  if (input.fileSizeBytes != null) payload.file_size_bytes = input.fileSizeBytes
  if (input.uploadedBy !== undefined) payload.uploaded_by = input.uploadedBy
  if (input.requirementId !== undefined) {
    payload.ahj_document_requirement_id = input.requirementId
  }
  return payload
}

async function updateMatchingRows(supabase, jobId, documentType, payload) {
  var update = await supabase
    .from('job_documents')
    .update(payload)
    .eq('job_id', jobId)
    .eq('document_type', documentType)
  if (update.error) {
    throw writeError(
      'canonical job_documents update failed: ' + update.error.message,
      update.error
    )
  }
}

/**
 * @param {object} supabase — service-role / server client
 * @param {object} input
 * @param {string} input.jobId
 * @param {string} input.documentType
 * @param {string} input.fileName
 * @param {string} input.filePath
 * @param {number} [input.fileSizeBytes]
 * @param {string} [input.mimeType]
 * @param {string|null} [input.requirementId]
 * @param {string|null} [input.uploadedBy]
 */
async function upsertCanonicalJobDocument(supabase, input) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw programmerError('upsertCanonicalJobDocument: supabase client is required')
  }

  var jobId = input && input.jobId
  var documentType = input && input.documentType
  var fileName = input && input.fileName
  var filePath = input && input.filePath

  if (!jobId || !documentType || !fileName || !filePath) {
    throw programmerError(
      'upsertCanonicalJobDocument: jobId, documentType, fileName, and filePath are required'
    )
  }
  if (!CANONICAL_NOC_DOCUMENT_TYPES[documentType]) {
    throw programmerError(
      'upsertCanonicalJobDocument: unsupported document_type ' + documentType
    )
  }

  var payload = buildPayload(input)
  var existing = await listExisting(supabase, jobId, documentType)
  if (existing.error) {
    throw writeError(
      'canonical job_documents lookup failed: ' + existing.error.message,
      existing.error
    )
  }

  var rows = existing.data || []
  if (rows.length > 0) {
    await updateMatchingRows(supabase, jobId, documentType, payload)
    return {
      id: rows[0].id,
      reused: true,
      alignedRows: rows.length,
    }
  }

  var insertRow = Object.assign(
    {
      job_id: jobId,
      document_type: documentType,
    },
    payload
  )

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

  // Concurrent first-insert lost the unique race. Reuse the winning row.
  var retry = await listExisting(supabase, jobId, documentType)
  if (retry.error) {
    throw writeError(
      'canonical job_documents uniqueness retry lookup failed: ' + retry.error.message,
      retry.error
    )
  }
  if (retry.data && retry.data.length > 0) {
    await updateMatchingRows(supabase, jobId, documentType, payload)
    return {
      id: retry.data[0].id,
      reused: true,
      raced: true,
      alignedRows: retry.data.length,
    }
  }

  throw writeError(
    'canonical job_documents unique violation but no winning row found: ' + insert.error.message,
    insert.error
  )
}

async function persistGeneratedNocDocument(supabase, jobId, filePath, fileSizeBytes) {
  return upsertCanonicalJobDocument(supabase, {
    jobId: jobId,
    documentType: 'notice_of_commencement',
    fileName: 'noc-filled.pdf',
    filePath: filePath,
    fileSizeBytes: fileSizeBytes,
    mimeType: 'application/pdf',
  })
}

async function persistNotarizedNocDocument(supabase, jobId, filePath, fileSizeBytes) {
  return upsertCanonicalJobDocument(supabase, {
    jobId: jobId,
    documentType: 'noc_uploaded_notarized',
    fileName: 'noc-notarized.pdf',
    filePath: filePath,
    fileSizeBytes: fileSizeBytes,
    mimeType: 'application/pdf',
  })
}

async function persistRecordedNocDocument(supabase, jobId, filePath, fileSizeBytes, uploadedBy) {
  return upsertCanonicalJobDocument(supabase, {
    jobId: jobId,
    documentType: 'noc_uploaded_recorded',
    fileName: 'noc-recorded.pdf',
    filePath: filePath,
    fileSizeBytes: fileSizeBytes,
    mimeType: 'application/pdf',
    uploadedBy: uploadedBy,
  })
}

async function persistUploadedNocDocument(supabase, jobId, nocOptionSuffix, fileName, filePath, fileSizeBytes, uploadedBy) {
  return upsertCanonicalJobDocument(supabase, {
    jobId: jobId,
    documentType: 'noc_uploaded_' + nocOptionSuffix,
    fileName: fileName,
    filePath: filePath,
    fileSizeBytes: fileSizeBytes,
    mimeType: 'application/pdf',
    uploadedBy: uploadedBy,
  })
}

module.exports = {
  upsertCanonicalJobDocument: upsertCanonicalJobDocument,
  persistGeneratedNocDocument: persistGeneratedNocDocument,
  persistNotarizedNocDocument: persistNotarizedNocDocument,
  persistRecordedNocDocument: persistRecordedNocDocument,
  persistUploadedNocDocument: persistUploadedNocDocument,
  CANONICAL_NOC_DOCUMENT_TYPES: CANONICAL_NOC_DOCUMENT_TYPES,
  isUniqueViolation: isUniqueViolation,
}
