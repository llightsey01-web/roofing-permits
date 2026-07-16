import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../../lib/auth/session.js'
import { createClient } from '../../../../../../lib/supabase-server.js'

const require = createRequire(import.meta.url)
const {
  UPLOADED_NOC_PATH,
  MAX_NOC_UPLOAD_BYTES,
  isValidNocOption,
  requiresUpload,
  buildJobUpdateForUploadedNoc,
  nextRunTypeForNocOption,
} = require('../../../../../../lib/noc/noc-options.js')

async function queueAutomationRun(supabase, jobId, runType) {
  const { error } = await supabase.from('automation_runs').insert({
    job_id: jobId,
    run_type: runType,
    run_status: 'queued',
    started_at: new Date().toISOString(),
    attempts: 0,
  })
  if (error) throw new Error('Failed to queue ' + runType + ': ' + error.message)
}

export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const access = await assertJobAccess(context.userSupabase, id, context.companyId)
    if (access.error) {
      return Response.json({ error: access.error }, { status: access.status })
    }

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return Response.json({ error: 'multipart/form-data required' }, { status: 400 })
    }

    const formData = await request.formData()
    const nocOption = String(formData.get('noc_option') || '').trim()
    const queueNext = formData.get('queue_next') !== 'false'
    const file = formData.get('file')

    if (!isValidNocOption(nocOption) || !requiresUpload(nocOption)) {
      return Response.json({
        error: 'noc_option must be upload_signed, upload_notarized, or upload_recorded',
      }, { status: 400 })
    }

    if (!file || typeof file.arrayBuffer !== 'function') {
      return Response.json({ error: 'PDF file is required' }, { status: 400 })
    }

    const mime = file.type || ''
    if (mime && mime !== 'application/pdf') {
      return Response.json({ error: 'PDF only' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length === 0) {
      return Response.json({ error: 'Empty file' }, { status: 400 })
    }
    if (buffer.length > MAX_NOC_UPLOAD_BYTES) {
      return Response.json({ error: 'File must be 10MB or smaller' }, { status: 400 })
    }

    const { data: job, error: jobError } = await context.userSupabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .eq('company_id', context.companyId)
      .single()

    if (jobError || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    const supabase = createClient()
    const storagePath = UPLOADED_NOC_PATH(id)
    const { error: uploadError } = await supabase.storage
      .from('job-documents')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      return Response.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })
    }

    const update = buildJobUpdateForUploadedNoc(job, nocOption, storagePath)
    const { data: updated, error: updateError } = await supabase
      .from('jobs')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    try {
      await supabase.from('job_documents').insert({
        job_id: id,
        document_type: 'noc_uploaded_' + nocOption.replace('upload_', ''),
        file_name: file.name || 'noc-uploaded.pdf',
        file_path: storagePath,
        mime_type: 'application/pdf',
        uploaded_by: context.user?.id || null,
      })
    } catch (docErr) {
      console.warn('[upload-noc] job_documents insert skipped:', docErr.message)
    }

    let queued = null
    if (queueNext) {
      const runType = nextRunTypeForNocOption(nocOption)
      if (runType) {
        await queueAutomationRun(supabase, id, runType)
        queued = runType
      }
    }

    return Response.json({
      success: true,
      job: updated,
      path: storagePath,
      queued: queued,
    })
  } catch (err) {
    console.error('[upload-noc] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
