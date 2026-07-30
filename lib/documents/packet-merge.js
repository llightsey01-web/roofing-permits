/**
 * Combined packet merge — pdf-lib page-copy merge in AHJ requirement sort_order.
 * Only runs when job is issued/approved AND every required document is present in job_documents.
 */
'use strict'

var { PDFDocument } = require('pdf-lib')
var {
  loadAhjRequirements,
  findDocumentForRole,
  requiredDocsPresent,
  isIssuedStatus,
} = require('./document-folder')

/**
 * @returns {Promise<{ merged: boolean, reason?: string, filePath?: string, documentId?: string }>}
 */
async function maybeMergeCombinedPacket(supabase, job, options) {
  var opts = options || {}
  if (!job || !job.id) return { merged: false, reason: 'job required' }
  if (!isIssuedStatus(job.job_status)) {
    return { merged: false, reason: 'job not issued/approved' }
  }
  if (!job.ahj_id) {
    return { merged: false, reason: 'job missing ahj_id' }
  }

  var requirements = opts.requirements || (await loadAhjRequirements(supabase, job.ahj_id))
  var required = (requirements || []).filter(function (r) { return r.required })
  if (!required.length) {
    return { merged: false, reason: 'no required document roles configured for AHJ' }
  }

  var docsResult = await supabase
    .from('job_documents')
    .select('id, document_type, file_name, file_path, mime_type, uploaded_at')
    .eq('job_id', job.id)
  if (docsResult.error) {
    return { merged: false, reason: docsResult.error.message }
  }
  var documents = docsResult.data || []

  if (!requiredDocsPresent(required, documents)) {
    return { merged: false, reason: 'required document(s) missing' }
  }

  // Skip re-merge if combined_packet already exists unless force
  var existing = findDocumentForRole(documents, 'combined_packet')
  if (existing && !opts.force) {
    return { merged: false, reason: 'combined_packet already present', filePath: existing.file_path, documentId: existing.id }
  }

  var ordered = required.slice().sort(function (a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0)
  })

  var mergedPdf = await PDFDocument.create()
  for (var i = 0; i < ordered.length; i++) {
    var req = ordered[i]
    var doc = findDocumentForRole(documents, req.document_role)
    if (!doc || !doc.file_path) {
      return { merged: false, reason: 'missing file for role ' + req.document_role }
    }
    var download = await supabase.storage.from('job-documents').download(doc.file_path)
    if (download.error || !download.data) {
      return { merged: false, reason: 'download failed for ' + req.document_role + ': ' + (download.error && download.error.message) }
    }
    var bytes = Buffer.from(await download.data.arrayBuffer())
    var src = await PDFDocument.load(bytes)
    var pages = await mergedPdf.copyPages(src, src.getPageIndices())
    pages.forEach(function (page) {
      mergedPdf.addPage(page)
    })
  }

  var pdfBytes = Buffer.from(await mergedPdf.save())
  var filePath = 'jobs/' + job.id + '/generated/combined-packet.pdf'
  var upload = await supabase.storage
    .from('job-documents')
    .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (upload.error) {
    return { merged: false, reason: 'upload failed: ' + upload.error.message }
  }

  // Upsert job_documents row for combined_packet
  if (existing) {
    await supabase
      .from('job_documents')
      .update({
        file_path: filePath,
        file_name: 'Complete Packet.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: pdfBytes.length,
        uploaded_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    return { merged: true, filePath: filePath, documentId: existing.id }
  }

  var insert = await supabase
    .from('job_documents')
    .insert({
      job_id: job.id,
      document_type: 'combined_packet',
      file_name: 'Complete Packet.pdf',
      file_path: filePath,
      mime_type: 'application/pdf',
      file_size_bytes: pdfBytes.length,
    })
    .select('id')
    .single()

  if (insert.error) {
    return { merged: false, reason: 'job_documents insert failed: ' + insert.error.message, filePath: filePath }
  }

  return { merged: true, filePath: filePath, documentId: insert.data.id }
}

module.exports = {
  maybeMergeCombinedPacket,
}
