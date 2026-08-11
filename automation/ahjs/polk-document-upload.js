'use strict'

/**
 * Polk post-submit document upload helpers.
 *
 * SERVER / WORKER ONLY. Does not call Stripe. Does not mark permits issued.
 *
 * Upload targets CapDetail / FileUpload/AttachmentsList.aspx for an explicit
 * portal_record_number (submitted Accela alt ID). jobs.permit_number is NOT used —
 * that field is set by Mark Permit Issued after county approval.
 *
 * Selectors under config.postSubmitAttachments are provisional until
 * confirmedForRoofingPermit is flipped true after a live discovery pass.
 */

var {
  findDocumentForRole,
  loadAhjRequirements,
} = require('../../lib/documents/document-folder.js')

/**
 * Requirements that belong in the post-submit attachments upload set.
 * Excludes roles that require a county-issued permit number (e.g. approved_permit).
 *
 * @param {object[]} requirements — ahj_document_requirements rows
 * @returns {object[]}
 */
function selectPostSubmitUploadRequirements(requirements) {
  return (requirements || []).filter(function (req) {
    if (!req || !req.required) return false
    if (req.requires_permit_number) return false
    var role = String(req.document_role || '')
    if (role === 'combined_packet' || role === 'approved_permit') return false
    return true
  })
}

/**
 * Build the upload plan for a job. Fail closed if any required post-submit
 * document is missing — never returns a partial plan for uploading a subset.
 *
 * @param {object} input
 * @param {object[]} input.requirements
 * @param {object[]} input.documents — job_documents rows
 * @returns {{ ok: true, items: object[] } | { ok: false, missingRoles: string[], errorCode: string }}
 */
function buildPostSubmitUploadPlan(input) {
  var opts = input || {}
  var required = selectPostSubmitUploadRequirements(opts.requirements)
  var missingRoles = []
  var items = []

  for (var i = 0; i < required.length; i++) {
    var req = required[i]
    var doc = findDocumentForRole(opts.documents, req.document_role)
    if (!doc || !doc.file_path) {
      missingRoles.push(req.document_role)
      continue
    }
    items.push({
      role: req.document_role,
      displayName: req.display_name || req.document_role,
      documentId: doc.id,
      documentType: doc.document_type,
      fileName: doc.file_name || (req.document_role + '.pdf'),
      filePath: doc.file_path,
      mimeType: doc.mime_type || null,
    })
  }

  if (missingRoles.length > 0) {
    return {
      ok: false,
      errorCode: 'missing_required_documents',
      missingRoles: missingRoles,
      items: [],
      message:
        'Missing required post-submit documents (fail closed, no partial upload): ' +
        missingRoles.join(', '),
    }
  }

  return { ok: true, items: items, missingRoles: [], errorCode: null }
}

/**
 * Load AHJ requirements and build a fail-closed upload plan for the job.
 * @param {object} supabase
 * @param {object} jobData — must include ahj_id and documents[]
 */
async function resolvePostSubmitUploadPlan(supabase, jobData) {
  if (!jobData || !jobData.ahj_id) {
    throw Object.assign(new Error('permit_document_upload requires job.ahj_id'), {
      errorCode: 'missing_ahj_id',
    })
  }
  var requirements = await loadAhjRequirements(supabase, jobData.ahj_id)
  var plan = buildPostSubmitUploadPlan({
    requirements: requirements,
    documents: jobData.documents || [],
  })
  if (!plan.ok) {
    throw Object.assign(new Error(plan.message), {
      errorCode: plan.errorCode,
      missingRoles: plan.missingRoles,
    })
  }
  return {
    requirements: requirements,
    items: plan.items,
  }
}

/**
 * True when the page is CapDetail or AttachmentsList (post-submit surfaces).
 * CapEdit / ShoppingCart / Forte are not valid for this run type.
 */
function isPostSubmitAttachmentSurface(url, pageText) {
  var u = String(url || '')
  var text = String(pageText || '')
  if (/ShoppingCart\.aspx|Pay Fees|CSG Forte|Payment information/i.test(u + ' ' + text)) {
    return false
  }
  if (/CapEdit\.aspx/i.test(u)) return false
  if (/CapDetail\.aspx|AttachmentsList\.aspx|FileUpload\/AttachmentsList/i.test(u)) return true
  return false
}

/**
 * Assert config admits live upload clicks. Provisional Batch B selectors alone
 * are not enough — confirmedForRoofingPermit must be true after discovery.
 */
function assertUploadSelectorsConfirmed(config) {
  var cfg = config && config.postSubmitAttachments
  if (!cfg || cfg.confirmedForRoofingPermit !== true) {
    throw Object.assign(
      new Error(
        'Polk post-submit attachment selectors are not confirmed for roofing CapDetail. ' +
        'Run scripts/diagnostics/ahj-discovery/polk-attachments-discovery.js against a real ' +
        'submitted record, then set postSubmitAttachments.confirmedForRoofingPermit = true.'
      ),
      { errorCode: 'selectors_unconfirmed' }
    )
  }
  var requiredKeys = ['attachmentsTab', 'fileInput', 'browseAdd']
  for (var i = 0; i < requiredKeys.length; i++) {
    var key = requiredKeys[i]
    if (!cfg.selectors || !cfg.selectors[key] || !String(cfg.selectors[key]).trim()) {
      throw Object.assign(
        new Error('postSubmitAttachments.selectors.' + key + ' is required when confirmed'),
        { errorCode: 'selectors_unconfirmed' }
      )
    }
  }
}

module.exports = {
  selectPostSubmitUploadRequirements,
  buildPostSubmitUploadPlan,
  resolvePostSubmitUploadPlan,
  isPostSubmitAttachmentSurface,
  assertUploadSelectorsConfirmed,
}
