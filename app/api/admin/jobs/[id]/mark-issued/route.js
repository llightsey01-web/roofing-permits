import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Admin: Mark permit issued.
 * Body: { permit_number: string, permit_pdf_base64?: string, file_name?: string }
 * - Writes jobs.permit_number + permit_issued_at
 * - Sets job_status to permit_issued
 * - Optionally uploads approved permit PDF as job_documents.document_type = approved_permit
 * - Attempts combined packet merge (no-op if required docs missing)
 */
export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const body = await request.json().catch(function () { return {} })
    const permitNumber = typeof body.permit_number === 'string' ? body.permit_number.trim() : ''
    if (!permitNumber) {
      return Response.json({ error: 'permit_number is required' }, { status: 400 })
    }

    const issuedAt = new Date().toISOString()
    const { data: job, error: jobError } = await context.supabase
      .from('jobs')
      .update({
        permit_number: permitNumber,
        permit_issued_at: issuedAt,
        job_status: 'permit_issued',
        updated_at: issuedAt,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (jobError || !job) {
      return Response.json({ error: jobError?.message || 'Job not found' }, { status: 404 })
    }

    let approvedPermitDoc = null
    const pdfBase64 = typeof body.permit_pdf_base64 === 'string' ? body.permit_pdf_base64 : ''
    if (pdfBase64) {
      const raw = pdfBase64.replace(/^data:application\/pdf;base64,/, '')
      const pdfBytes = Buffer.from(raw, 'base64')
      if (!pdfBytes.length) {
        return Response.json({ error: 'Invalid permit PDF payload' }, { status: 400 })
      }
      const fileName = (typeof body.file_name === 'string' && body.file_name.trim())
        ? body.file_name.trim()
        : ('approved-permit-' + permitNumber.replace(/[^a-zA-Z0-9_-]+/g, '_') + '.pdf')
      const filePath = 'jobs/' + id + '/approved/' + fileName

      const upload = await context.supabase.storage
        .from('job-documents')
        .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
      if (upload.error) {
        return Response.json({ error: 'Failed to upload approved permit: ' + upload.error.message }, { status: 500 })
      }

      const insert = await context.supabase
        .from('job_documents')
        .insert({
          job_id: id,
          document_type: 'approved_permit',
          file_name: fileName,
          file_path: filePath,
          mime_type: 'application/pdf',
          file_size_bytes: pdfBytes.length,
          uploaded_by: context.user?.id || null,
        })
        .select('id, document_type, file_name, file_path')
        .single()

      if (insert.error) {
        return Response.json({ error: 'Failed to record approved_permit document: ' + insert.error.message }, { status: 500 })
      }
      approvedPermitDoc = insert.data
    }

    const { maybeMergeCombinedPacket } = require('../../../../../../lib/documents/packet-merge')
    let mergeResult = { merged: false, reason: 'not attempted' }
    try {
      mergeResult = await maybeMergeCombinedPacket(context.supabase, job, { force: true })
    } catch (mergeErr) {
      console.warn('[mark-issued] packet merge failed:', mergeErr.message)
      mergeResult = { merged: false, reason: mergeErr.message }
    }

    return Response.json({
      success: true,
      job: {
        id: job.id,
        permit_number: job.permit_number,
        permit_issued_at: job.permit_issued_at,
        job_status: job.job_status,
      },
      approvedPermitDoc: approvedPermitDoc,
      packetMerge: mergeResult,
    })
  } catch (err) {
    console.error('[admin/jobs/mark-issued]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
