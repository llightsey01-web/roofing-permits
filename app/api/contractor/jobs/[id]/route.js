import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../lib/auth/session.js'

export async function GET(request, { params }) {
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

    const { data: job, error: jobError } = await context.userSupabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .eq('company_id', context.companyId)
      .single()

    if (jobError || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    const { data: documents } = await context.userSupabase
      .from('job_documents')
      .select('id, document_type, file_name, file_path, uploaded_at, mime_type')
      .eq('job_id', id)
      .order('uploaded_at', { ascending: false })

    const { data: logs } = await context.userSupabase
      .from('automation_logs')
      .select('id, step_name, message, created_at, log_level')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    const signedUrls = {}
    const pathsToSign = []

    if (job.noc_file_path) pathsToSign.push({ key: 'generated_noc', path: job.noc_file_path })
    const notarizedPath = job.job_specs?.proof?.notarized_file_path
    const recordedPath = job.job_specs?.erecord?.recorded_file_path
    if (notarizedPath) pathsToSign.push({ key: 'notarized_noc', path: notarizedPath })
    if (recordedPath) pathsToSign.push({ key: 'recorded_noc', path: recordedPath })

    for (const item of pathsToSign) {
      const { data: signed } = await context.supabase.storage
        .from('job-documents')
        .createSignedUrl(item.path, 3600)
      if (signed?.signedUrl) signedUrls[item.key] = signed.signedUrl
    }

    const screenshotDocs = (documents || []).filter(d =>
      d.document_type?.includes('screenshot') || d.document_type === 'permit_screenshot'
    )

    for (const doc of screenshotDocs.slice(0, 10)) {
      const { data: signed } = await context.supabase.storage
        .from('job-documents')
        .createSignedUrl(doc.file_path, 3600)
      if (signed?.signedUrl) {
        signedUrls[`doc_${doc.id}`] = signed.signedUrl
      }
    }

    return Response.json({
      job,
      documents: documents || [],
      logs: logs || [],
      downloadUrls: signedUrls,
    })
  } catch (err) {
    console.error('Get contractor job error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
