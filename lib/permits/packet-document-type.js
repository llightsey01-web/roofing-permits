// lib/permits/packet-document-type.js
// ZIG-17 PR 3: centralized requirement role → coarse document_type mapping.
// Unknown generated roles fail closed. Do not string-cast arbitrary roles.
'use strict'

var { packetConfigInvalidError } = require('./packet-field-map')

var CANONICAL_DOCUMENT_TYPES = Object.freeze([
  'contractor_license',
  'qualifier_license',
  'insurance_certificate',
  'notice_of_commencement',
  'owners_affidavit',
  'product_approval',
  'site_plan',
  'photo_existing_roof',
  'signed_contract',
  'other',
  'approved_permit',
  'combined_packet',
  'permit_screenshot',
  'noc_uploaded_signed',
  'noc_uploaded_notarized',
  'noc_uploaded_recorded',
  'submission_packet',
  'permit_application',
])

var CANONICAL_DOCUMENT_TYPE_SET = Object.freeze(
  CANONICAL_DOCUMENT_TYPES.reduce(function (acc, label) {
    acc[label] = true
    return acc
  }, Object.create(null))
)

// Explicit generated-role aliases. Canonical roles identity-map separately.
var GENERATED_ROLE_ALIASES = Object.freeze({
  permit_application: 'permit_application',
  roofing_affidavit: 'owners_affidavit',
  noc_recorded: 'notice_of_commencement',
})

var ROLE_MATCH_ALIASES = Object.freeze({
  noc_recorded: ['noc_recorded', 'notice_of_commencement', 'noc_uploaded_recorded'],
  notice_of_commencement: ['notice_of_commencement', 'noc_recorded', 'noc_uploaded_recorded'],
  product_approval: ['product_approval'],
  permit_application: ['permit_application'],
  owners_affidavit: ['owners_affidavit'],
  roofing_affidavit: ['roofing_affidavit', 'owners_affidavit'],
  approved_permit: ['approved_permit'],
  combined_packet: ['combined_packet'],
})

function normalizeRole(role) {
  return role == null ? '' : String(role).trim()
}

/**
 * Acceptable job_documents.document_type values for a requirement role.
 * Used for legacy null-requirement fallback matching only.
 */
function documentTypesForRole(documentRole) {
  var role = normalizeRole(documentRole)
  if (!role) return []
  if (ROLE_MATCH_ALIASES[role]) return ROLE_MATCH_ALIASES[role].slice()
  return [role]
}

function unknownGeneratedRoleError(documentRole) {
  return packetConfigInvalidError(
    'unknown generated document_role "' + String(documentRole || '') + '"',
    [
      {
        code: 'unknown_generated_role',
        document_role: documentRole || null,
        message:
          'unknown generated document_role "' +
          String(documentRole || '') +
          '"',
      },
    ]
  )
}

/**
 * Coarse document_type for a dart_generated requirement.
 * @returns {string}
 * @throws packet_config_invalid (unknown_generated_role)
 */
function coarseDocumentTypeForGeneratedRole(documentRole) {
  var role = normalizeRole(documentRole)
  if (!role) {
    throw unknownGeneratedRoleError(documentRole)
  }
  if (Object.prototype.hasOwnProperty.call(GENERATED_ROLE_ALIASES, role)) {
    return GENERATED_ROLE_ALIASES[role]
  }
  if (CANONICAL_DOCUMENT_TYPE_SET[role]) {
    return role
  }
  throw unknownGeneratedRoleError(role)
}

module.exports = {
  CANONICAL_DOCUMENT_TYPES: CANONICAL_DOCUMENT_TYPES,
  CANONICAL_DOCUMENT_TYPE_SET: CANONICAL_DOCUMENT_TYPE_SET,
  GENERATED_ROLE_ALIASES: GENERATED_ROLE_ALIASES,
  documentTypesForRole: documentTypesForRole,
  coarseDocumentTypeForGeneratedRole: coarseDocumentTypeForGeneratedRole,
}
