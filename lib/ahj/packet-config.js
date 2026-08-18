// lib/ahj/packet-config.js
// ZIG-10: AHJ physical-submission packet requirement loading + config validation.
// Pure validation over requirement rows — does not inspect job_documents.

'use strict'

/**
 * Terminal, non-retryable packet configuration failure.
 * @param {string|null|undefined} ahjId
 * @param {string} reason
 */
function packetConfigMissingError(ahjId, reason) {
  var idLabel = ahjId == null || ahjId === '' ? '(missing ahj_id)' : String(ahjId)
  var detail = reason == null || reason === '' ? 'packet configuration is missing or invalid' : String(reason)
  return Object.assign(
    new Error('packet_config_missing for AHJ ' + idLabel + ': ' + detail),
    { errorCode: 'packet_config_missing', nonRetryable: true }
  )
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasUsableFieldMap(fieldMap) {
  if (!fieldMap || typeof fieldMap !== 'object' || Array.isArray(fieldMap)) return false
  return Object.keys(fieldMap).length > 0
}

/**
 * Validate loaded ahj_document_requirements rows for pdf_packet assembly readiness.
 * Does not inspect job documents.
 * @param {object[]|null|undefined} requirements
 * @returns {{ valid: boolean, reason?: string }}
 */
function isPacketConfigValid(requirements) {
  var rows = requirements || []
  if (!rows.length) {
    return { valid: false, reason: 'no ahj_document_requirements rows' }
  }

  var hasRequiredIncluded = false

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {}

    if (!isNonEmptyString(row.document_role)) {
      return { valid: false, reason: 'document_role is blank on one or more rows' }
    }
    if (!isNonEmptyString(row.display_name)) {
      return {
        valid: false,
        reason: 'display_name is blank for document_role=' + String(row.document_role),
      }
    }

    if (row.include_in_submission_packet === true && row.required === true) {
      hasRequiredIncluded = true
    }

    if (row.source_type === 'dart_generated') {
      if (!isNonEmptyString(row.template_storage_path)) {
        return {
          valid: false,
          reason:
            'dart_generated row missing template_storage_path for document_role=' +
            String(row.document_role),
        }
      }
      if (!hasUsableFieldMap(row.field_map)) {
        return {
          valid: false,
          reason:
            'dart_generated row missing usable field_map for document_role=' +
            String(row.document_role),
        }
      }
    }
  }

  if (!hasRequiredIncluded) {
    return {
      valid: false,
      reason: 'no row with include_in_submission_packet=true AND required=true',
    }
  }

  return { valid: true }
}

/**
 * Load ordered packet requirements for an AHJ.
 * Zero rows → packet_config_missing (fail closed).
 *
 * @param {object} supabase
 * @param {string} ahjId
 * @returns {Promise<object[]>}
 */
async function loadPacketRequirements(supabase, ahjId) {
  if (!supabase || typeof supabase.from !== 'function') {
    throw packetConfigMissingError(ahjId, 'supabase client is required')
  }
  if (!ahjId) {
    throw packetConfigMissingError(ahjId, 'ahj_id is required')
  }

  var result = await supabase
    .from('ahj_document_requirements')
    .select('*')
    .eq('ahj_id', ahjId)
    .order('sort_order', { ascending: true })
    .order('document_role', { ascending: true })

  if (result.error) {
    throw packetConfigMissingError(
      ahjId,
      'failed to load ahj_document_requirements: ' + result.error.message
    )
  }

  var rows = result.data || []
  if (!rows.length) {
    throw packetConfigMissingError(ahjId, 'no ahj_document_requirements rows')
  }

  return rows
}

module.exports = {
  loadPacketRequirements,
  isPacketConfigValid,
  packetConfigMissingError,
}
