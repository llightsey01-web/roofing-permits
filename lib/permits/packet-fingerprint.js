// lib/permits/packet-fingerprint.js
// ZIG-17 PR 4 Phase B: deterministic packet fingerprints.
// Side-effect free. Does not query Supabase, download Storage, load/sort
// requirements, or call RPCs. Caller supplies merge-ordered entries + bytes.
//
// Ordering authority is PR 3 runPermitPacket mergeBytes:
//   loadPacketRequirements (sort_order, document_role)
//   → includedRequirements (filter only)
//   → resolveIncludedRequirement found artifacts, push order
//   → mergePdfBuffers(mergeBytes)
//
// Invariant: buildInputDocument(orderedEntries).requirements[i]
// corresponds to mergeBytes[i]. This module never reorders entries.
//
// Phase C adapter (do not change PR 3 runtime shapes here):
//   orderedEntries[i] = {
//     ahjId: job.ahj_id || requirement.ahj_id,
//     requirement: <ahj_document_requirements row>,
//     resolvedValues: <source.path → exact fill value|null>,
//     artifact: {
//       documentId: resolved.document.id,
//       documentType: resolved.document.document_type,
//       filePath: resolved.document.file_path,
//       bytes: resolved.bytes, // same Buffer as mergeBytes[i]
//     },
//   }
// resolvedValues is NOT resolveFieldValues().values (array of pdfField rows).
// Phase C must collapse that array to a map of field_map source paths.
'use strict'

var crypto = require('crypto')

var ERROR_CODE = 'packet_fingerprint_invalid'
var HEX64 = /^[0-9a-f]{64}$/
var STORED_VERSION = 1
var INPUT_VERSION = 1

function fingerprintInvalidError(reason) {
  var detail =
    reason == null || reason === '' ? 'packet fingerprint input is invalid' : String(reason)
  return Object.assign(new Error('packet_fingerprint_invalid: ' + detail), {
    errorCode: ERROR_CODE,
    nonRetryable: true,
  })
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isTypedArray(value) {
  return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)
}

/**
 * Recursively canonicalize a JSON-compatible value.
 * Object keys are sorted lexicographically. Array order is preserved.
 * Does not mutate the input. Circular refs and non-JSON values fail closed.
 */
function canonicalize(value, seen) {
  if (value === null) return null
  var t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw fingerprintInvalidError('non-finite number is not JSON-canonical')
    }
    return value === 0 ? 0 : value
  }
  if (t === 'undefined') {
    throw fingerprintInvalidError('undefined is not JSON-canonical')
  }
  if (t === 'bigint' || t === 'function' || t === 'symbol') {
    throw fingerprintInvalidError(t + ' is not JSON-canonical')
  }
  if (t !== 'object') {
    throw fingerprintInvalidError('unsupported value type ' + t)
  }
  if (seen.has(value)) {
    throw fingerprintInvalidError('circular reference is not JSON-canonical')
  }
  if (Array.isArray(value)) {
    seen.add(value)
    var items = []
    for (var i = 0; i < value.length; i++) {
      if (value[i] === undefined) {
        seen.delete(value)
        throw fingerprintInvalidError('undefined array element is not JSON-canonical')
      }
      items.push(canonicalize(value[i], seen))
    }
    seen.delete(value)
    return items
  }
  if (Buffer.isBuffer(value) || isTypedArray(value)) {
    throw fingerprintInvalidError('binary values are not JSON-canonical')
  }
  if (value instanceof Date) {
    throw fingerprintInvalidError('Date is not JSON-canonical')
  }
  if (!isPlainObject(value)) {
    throw fingerprintInvalidError('unsupported object type is not JSON-canonical')
  }
  seen.add(value)
  var keys = Object.keys(value).sort()
  var out = {}
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k]
    if (value[key] === undefined) {
      seen.delete(value)
      throw fingerprintInvalidError('undefined object value is not JSON-canonical')
    }
    out[key] = canonicalize(value[key], seen)
  }
  seen.delete(value)
  return out
}

/**
 * Deterministic UTF-8 JSON text. Object keys sorted; arrays keep caller order.
 * @param {*} value
 * @returns {string}
 */
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, new Set()))
}

/**
 * SHA-256 lowercase hex of a UTF-8 string, Buffer, or Uint8Array.
 * @param {string|Buffer|Uint8Array} bytesOrString
 * @returns {string}
 */
function sha256Hex(bytesOrString) {
  var buf
  if (typeof bytesOrString === 'string') {
    buf = Buffer.from(bytesOrString, 'utf8')
  } else if (Buffer.isBuffer(bytesOrString)) {
    buf = bytesOrString
  } else if (bytesOrString instanceof Uint8Array) {
    buf = Buffer.from(bytesOrString)
  } else {
    throw fingerprintInvalidError('sha256Hex requires a string, Buffer, or Uint8Array')
  }
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fingerprintInvalidError(label + ' is required')
  }
  return value
}

function requireBoolean(value, label) {
  if (value !== true && value !== false) {
    throw fingerprintInvalidError(label + ' must be a boolean')
  }
  return value
}

function normalizeSortOrder(value) {
  if (value == null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw fingerprintInvalidError('sort_order must be a finite number')
  }
  return value
}

function normalizeTemplatePath(value) {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw fingerprintInvalidError('template_storage_path must be a string or null')
  }
  var trimmed = value.trim()
  return trimmed === '' ? null : value
}

function usedSourcePaths(fieldMap) {
  if (fieldMap == null) return []
  if (!isPlainObject(fieldMap)) {
    throw fingerprintInvalidError('field_map must be an object or null')
  }
  if (!Object.prototype.hasOwnProperty.call(fieldMap, 'fields')) {
    throw fingerprintInvalidError('field_map.fields is required when field_map is present')
  }
  if (!Array.isArray(fieldMap.fields)) {
    throw fingerprintInvalidError('field_map.fields must be an array')
  }
  var paths = []
  var seen = Object.create(null)
  for (var i = 0; i < fieldMap.fields.length; i++) {
    var entry = fieldMap.fields[i]
    if (!entry || typeof entry !== 'object') {
      throw fingerprintInvalidError('field_map.fields[' + i + '] is invalid')
    }
    var source = entry.source
    if (typeof source !== 'string' || source.trim() === '') {
      throw fingerprintInvalidError('field_map.fields[' + i + '].source is required')
    }
    if (seen[source]) continue
    seen[source] = true
    paths.push(source)
  }
  return paths
}

function resolvedScalar(value, sourcePath) {
  if (value === null) return null
  var t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw fingerprintInvalidError('resolved_values[' + sourcePath + '] is not a finite number')
    }
    return value === 0 ? 0 : value
  }
  throw fingerprintInvalidError(
    'resolved_values[' + sourcePath + '] must be a string, number, boolean, or null'
  )
}

function buildResolvedValues(fieldMap, resolvedValues) {
  var paths = usedSourcePaths(fieldMap)
  var source = resolvedValues == null ? {} : resolvedValues
  if (!isPlainObject(source)) {
    throw fingerprintInvalidError('resolvedValues must be a plain object or null')
  }
  var out = {}
  for (var i = 0; i < paths.length; i++) {
    var path = paths[i]
    if (Object.prototype.hasOwnProperty.call(source, path)) {
      out[path] = resolvedScalar(source[path], path)
    } else {
      out[path] = null
    }
  }
  return out
}

function toBytes(value, label) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw fingerprintInvalidError(label + ' must be a Buffer or Uint8Array')
}

function readAhjId(entry, requirement) {
  if (entry.ahjId != null && entry.ahjId !== '') return String(entry.ahjId)
  if (requirement && requirement.ahj_id != null && requirement.ahj_id !== '') {
    return String(requirement.ahj_id)
  }
  throw fingerprintInvalidError('ahj_id is required')
}

/**
 * @typedef {object} PacketFingerprintRequirement
 * @property {string} id
 * @property {string} [ahj_id]
 * @property {number} [sort_order]
 * @property {string} document_role
 * @property {string} source_type
 * @property {boolean} required
 * @property {boolean} include_in_submission_packet
 * @property {string|null} [template_storage_path]
 * @property {object|null} [field_map]
 */

/**
 * @typedef {object} PacketFingerprintArtifact
 * @property {string} documentId
 * @property {string} documentType
 * @property {string} filePath
 * @property {Buffer|Uint8Array} bytes
 */

/**
 * Caller-provided merge participant. Order must equal PR 3 mergeBytes order.
 * @typedef {object} PacketFingerprintEntry
 * @property {string} [ahjId]
 * @property {PacketFingerprintRequirement} requirement
 * @property {Object<string, string|number|boolean|null>|null} [resolvedValues]
 * @property {PacketFingerprintArtifact} artifact
 */

function buildRequirementRow(entry, index) {
  if (!isPlainObject(entry)) {
    throw fingerprintInvalidError('orderedEntries[' + index + '] must be an object')
  }
  var requirement = entry.requirement
  if (!isPlainObject(requirement)) {
    throw fingerprintInvalidError('orderedEntries[' + index + '].requirement is required')
  }
  var artifact = entry.artifact
  if (!isPlainObject(artifact)) {
    throw fingerprintInvalidError('orderedEntries[' + index + '].artifact is required')
  }
  var bytes = toBytes(artifact.bytes, 'orderedEntries[' + index + '].artifact.bytes')
  var contentSha = sha256Hex(bytes)
  return {
    ahjId: readAhjId(entry, requirement),
    row: {
      requirement_id: requireNonEmptyString(
        requirement.id,
        'orderedEntries[' + index + '].requirement.id'
      ),
      sort_order: normalizeSortOrder(requirement.sort_order),
      document_role: requireNonEmptyString(
        requirement.document_role,
        'orderedEntries[' + index + '].requirement.document_role'
      ),
      source_type: requireNonEmptyString(
        requirement.source_type,
        'orderedEntries[' + index + '].requirement.source_type'
      ),
      is_required: requireBoolean(
        requirement.required,
        'orderedEntries[' + index + '].requirement.required'
      ),
      include_in_submission_packet: requireBoolean(
        requirement.include_in_submission_packet,
        'orderedEntries[' + index + '].requirement.include_in_submission_packet'
      ),
      template_storage_path: normalizeTemplatePath(requirement.template_storage_path),
      field_map: requirement.field_map == null ? null : requirement.field_map,
      resolved_values: buildResolvedValues(requirement.field_map, entry.resolvedValues),
      artifact: {
        document_id: requireNonEmptyString(
          artifact.documentId,
          'orderedEntries[' + index + '].artifact.documentId'
        ),
        document_type: requireNonEmptyString(
          artifact.documentType,
          'orderedEntries[' + index + '].artifact.documentType'
        ),
        file_path: requireNonEmptyString(
          artifact.filePath,
          'orderedEntries[' + index + '].artifact.filePath'
        ),
        content_sha256: contentSha,
      },
    },
  }
}

/**
 * Effective packet-input document. requirements[] order is caller order.
 * @param {PacketFingerprintEntry[]} orderedEntries
 * @returns {{ version: number, ahj_id: string, requirements: object[] }}
 */
function buildInputDocument(orderedEntries) {
  if (!Array.isArray(orderedEntries) || orderedEntries.length === 0) {
    throw fingerprintInvalidError('orderedEntries must be a non-empty array')
  }
  var requirements = []
  var ahjId = null
  for (var i = 0; i < orderedEntries.length; i++) {
    var built = buildRequirementRow(orderedEntries[i], i)
    if (ahjId == null) ahjId = built.ahjId
    else if (built.ahjId !== ahjId) {
      throw fingerprintInvalidError('ahj_id must be consistent across orderedEntries')
    }
    requirements.push(built.row)
  }
  return {
    version: INPUT_VERSION,
    ahj_id: ahjId,
    requirements: requirements,
  }
}

/**
 * SHA-256 of canonical JSON of effective packet inputs.
 * @param {PacketFingerprintEntry[]} orderedEntries
 * @returns {string}
 */
function inputFingerprint(orderedEntries) {
  return sha256Hex(canonicalJson(buildInputDocument(orderedEntries)))
}

/**
 * SHA-256 of assembled/durable submission-packet PDF bytes.
 * @param {Buffer|Uint8Array} submissionPacketBytes
 * @returns {string}
 */
function contentFingerprint(submissionPacketBytes) {
  var bytes = toBytes(submissionPacketBytes, 'submissionPacketBytes')
  if (!bytes.length) {
    throw fingerprintInvalidError('submissionPacketBytes must be non-empty')
  }
  return sha256Hex(bytes)
}

function normalizeComputedAt(computedAt) {
  var date
  if (computedAt instanceof Date) {
    date = computedAt
  } else if (typeof computedAt === 'string' && computedAt.trim() !== '') {
    date = new Date(computedAt)
  } else {
    throw fingerprintInvalidError('computedAt must be a Date or ISO-8601 string')
  }
  if (Number.isNaN(date.getTime()) || !Number.isFinite(date.getTime())) {
    throw fingerprintInvalidError('computedAt is invalid')
  }
  return date.toISOString()
}

/**
 * Versioned fingerprint envelope stored at jobs.job_specs.packet.fingerprint.
 * @param {{ orderedEntries: PacketFingerprintEntry[], submissionPacketBytes: Buffer|Uint8Array, computedAt: Date|string }} input
 * @returns {{ version: number, input_fingerprint: string, content_fingerprint: string, computed_at: string, artifacts: object[] }}
 */
function buildStoredFingerprint(input) {
  var data = input || {}
  var doc = buildInputDocument(data.orderedEntries)
  var artifacts = []
  for (var i = 0; i < doc.requirements.length; i++) {
    var req = doc.requirements[i]
    artifacts.push({
      requirement_id: req.requirement_id,
      document_id: req.artifact.document_id,
      content_sha256: req.artifact.content_sha256,
    })
  }
  return {
    version: STORED_VERSION,
    input_fingerprint: sha256Hex(canonicalJson(doc)),
    content_fingerprint: contentFingerprint(data.submissionPacketBytes),
    computed_at: normalizeComputedAt(data.computedAt),
    artifacts: artifacts,
  }
}

function isFingerprintHex(value) {
  return typeof value === 'string' && HEX64.test(value)
}

/**
 * Equality on version + input_fingerprint + content_fingerprint only.
 * Malformed/missing inputs return false.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function fingerprintsEqual(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  if (a.version !== STORED_VERSION || b.version !== STORED_VERSION) return false
  if (!isFingerprintHex(a.input_fingerprint) || !isFingerprintHex(b.input_fingerprint)) {
    return false
  }
  if (!isFingerprintHex(a.content_fingerprint) || !isFingerprintHex(b.content_fingerprint)) {
    return false
  }
  return (
    a.input_fingerprint === b.input_fingerprint &&
    a.content_fingerprint === b.content_fingerprint
  )
}

module.exports = {
  ERROR_CODE: ERROR_CODE,
  canonicalJson: canonicalJson,
  sha256Hex: sha256Hex,
  buildInputDocument: buildInputDocument,
  inputFingerprint: inputFingerprint,
  contentFingerprint: contentFingerprint,
  buildStoredFingerprint: buildStoredFingerprint,
  fingerprintsEqual: fingerprintsEqual,
  fingerprintInvalidError: fingerprintInvalidError,
}
