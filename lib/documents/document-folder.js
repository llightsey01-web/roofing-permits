/**
 * Job document folder — AHJ requirements + fulfillment helpers.
 */
'use strict'

/** Aliases: requirement document_role → acceptable job_documents.document_type values */
var DOCUMENT_TYPE_ALIASES = {
  noc_recorded: ['noc_recorded', 'notice_of_commencement', 'noc_uploaded_recorded'],
  notice_of_commencement: ['notice_of_commencement', 'noc_recorded', 'noc_uploaded_recorded'],
  product_approval: ['product_approval'],
  permit_application: ['permit_application'],
  owners_affidavit: ['owners_affidavit'],
  roofing_affidavit: ['roofing_affidavit', 'owners_affidavit'],
  approved_permit: ['approved_permit'],
  combined_packet: ['combined_packet'],
}

function typesForRole(documentRole) {
  var role = String(documentRole || '')
  if (DOCUMENT_TYPE_ALIASES[role]) return DOCUMENT_TYPE_ALIASES[role]
  return [role]
}

function findDocumentForRole(documents, documentRole) {
  var types = typesForRole(documentRole)
  var list = documents || []
  for (var i = 0; i < list.length; i++) {
    var doc = list[i]
    if (!doc || !doc.document_type) continue
    if (types.indexOf(doc.document_type) !== -1) return doc
  }
  return null
}

/**
 * Build folder rows for UI.
 * @returns {Array<{ role, displayName, required, requiresPermitNumber, sortOrder, status, document, downloadKey }>}
 * status: 'available' | 'pending' | 'not_required' | 'missing'
 */
function buildDocumentFolder(requirements, documents, job) {
  var permitNumber = job && job.permit_number ? String(job.permit_number).trim() : ''
  var rows = (requirements || []).slice().sort(function (a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0)
  })

  return rows.map(function (req) {
    var doc = findDocumentForRole(documents, req.document_role)
    var status
    if (!req.required && !doc) {
      status = 'not_required'
    } else if (req.requires_permit_number && !permitNumber && !doc) {
      status = 'pending'
    } else if (doc) {
      status = 'available'
    } else {
      status = 'missing'
    }

    return {
      id: req.id,
      role: req.document_role,
      displayName: req.display_name,
      required: !!req.required,
      requiresPermitNumber: !!req.requires_permit_number,
      templateStoragePath: req.template_storage_path || null,
      fieldMap: req.field_map || null,
      sortOrder: req.sort_order || 0,
      status: status,
      document: doc
        ? {
            id: doc.id,
            document_type: doc.document_type,
            file_name: doc.file_name,
            file_path: doc.file_path,
            uploaded_at: doc.uploaded_at,
          }
        : null,
      downloadKey: doc ? 'doc_' + doc.id : null,
      pendingReason:
        status === 'pending'
          ? 'Pending — available after permit submission'
          : null,
    }
  })
}

function requiredDocsPresent(requirements, documents) {
  var required = (requirements || []).filter(function (r) { return r.required })
  for (var i = 0; i < required.length; i++) {
    if (!findDocumentForRole(documents, required[i].document_role)) return false
  }
  return true
}

function isIssuedStatus(jobStatus) {
  return jobStatus === 'permit_issued' || jobStatus === 'approved'
}

async function loadAhjRequirements(supabase, ahjId) {
  if (!ahjId) return []
  var result = await supabase
    .from('ahj_document_requirements')
    .select('*')
    .eq('ahj_id', ahjId)
    .order('sort_order', { ascending: true })
  if (result.error) throw new Error(result.error.message)
  return result.data || []
}

module.exports = {
  DOCUMENT_TYPE_ALIASES,
  typesForRole,
  findDocumentForRole,
  buildDocumentFolder,
  requiredDocsPresent,
  isIssuedStatus,
  loadAhjRequirements,
}
