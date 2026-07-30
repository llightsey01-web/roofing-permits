/**
 * Affidavit generation infrastructure — reuses shared PDF fill helpers.
 * No templates populated yet: returns pending/not-configured until
 * ahj_document_requirements.template_storage_path is set AND jobs.permit_number exists when required.
 */
'use strict'

var { PDFDocument } = require('pdf-lib')
var {
  fillFormFromMap,
  detectAutofitOverflows,
  safeSetFieldAutoFit,
} = require('../pdf-fill/form-fill')

/**
 * @returns {Promise<{ status: string, message?: string, pdfBytes?: Buffer, filePath?: string }>}
 */
async function generateAffidavit(options) {
  var opts = options || {}
  var job = opts.job
  var requirement = opts.requirement
  var supabase = opts.supabase

  if (!job || !requirement) {
    return { status: 'error', message: 'job and requirement required' }
  }

  if (requirement.requires_permit_number && !(job.permit_number && String(job.permit_number).trim())) {
    return {
      status: 'pending',
      message: 'Pending — available after permit submission',
    }
  }

  if (!requirement.template_storage_path) {
    return {
      status: 'not_configured',
      message: 'Affidavit template not configured for this AHJ yet',
    }
  }

  if (!supabase) {
    return { status: 'error', message: 'supabase client required' }
  }

  var { data: templateData, error: templateError } = await supabase.storage
    .from('job-documents')
    .download(requirement.template_storage_path)
  if (templateError || !templateData) {
    return { status: 'error', message: 'Template download failed: ' + (templateError && templateError.message) }
  }

  var templateBytes = Buffer.from(await templateData.arrayBuffer())
  var pdfDoc = await PDFDocument.load(templateBytes)
  var form = pdfDoc.getForm()
  var fieldMap = requirement.field_map || {}
  var entries = Array.isArray(fieldMap.fields) ? fieldMap.fields : []

  // Overflow check using optional maxChars on each field entry
  var overflowCandidates = entries
    .filter(function (e) { return e.autofit && e.maxChars })
    .map(function (e) {
      var value = resolveAffidavitValue(e, job)
      return {
        field: e.pdfField || e.source,
        value: value,
        maxChars: e.maxChars,
        message: (e.pdfField || e.source) + ' exceeds affidavit template capacity',
      }
    })
  var overflows = detectAutofitOverflows(overflowCandidates)
  if (overflows.length) {
    return { status: 'overflow', message: overflows[0].message, overflows: overflows }
  }

  fillFormFromMap(form, entries, {
    resolveValue: function (source) {
      return resolveAffidavitValue({ source: source }, job)
    },
  })

  // Also apply simple string map: { "PDF Field Name": "job.owner_name" }
  if (!entries.length && fieldMap && typeof fieldMap === 'object') {
    Object.keys(fieldMap).forEach(function (pdfField) {
      if (pdfField === 'fields') return
      var source = fieldMap[pdfField]
      var value = resolveAffidavitValue({ source: source }, job)
      safeSetFieldAutoFit(form, pdfField, value)
    })
  }

  form.flatten()
  var pdfBytes = Buffer.from(await pdfDoc.save())
  var filePath = 'jobs/' + job.id + '/generated/' + (requirement.document_role || 'affidavit') + '.pdf'

  if (!opts.skipUpload) {
    var upload = await supabase.storage
      .from('job-documents')
      .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (upload.error) {
      return { status: 'error', message: 'Upload failed: ' + upload.error.message }
    }

    await supabase.from('job_documents').insert({
      job_id: job.id,
      document_type: requirement.document_role,
      file_name: (requirement.display_name || requirement.document_role) + '.pdf',
      file_path: filePath,
      mime_type: 'application/pdf',
      file_size_bytes: pdfBytes.length,
    })

    try {
      var { tryPacketMergeForJob } = require('./try-packet-merge')
      await tryPacketMergeForJob(supabase, job.id)
    } catch (mergeErr) {
      console.warn('[affidavit] packet merge skipped:', mergeErr.message)
    }
  }

  return { status: 'generated', pdfBytes: pdfBytes, filePath: filePath }
}

function resolveAffidavitValue(entry, job) {
  if (entry && entry.value != null) return entry.value
  var source = entry && entry.source
  if (!source) return ''
  if (source === 'permit_number') return job.permit_number || ''
  if (source === 'owner_name') return job.owner_name || ''
  if (source === 'property_address') return job.property_address || ''
  if (source === 'parcel_number') return job.parcel_number || ''
  if (typeof source === 'string' && source.indexOf('job.') === 0) {
    return job[source.slice(4)] || ''
  }
  return job[source] || ''
}

module.exports = {
  generateAffidavit,
  resolveAffidavitValue,
}
