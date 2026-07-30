import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../lib/auth/session.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

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

    const {
      loadAhjRequirements,
      buildDocumentFolder,
      findDocumentForRole,
    } = require('../../../../../lib/documents/document-folder')

    let requirements = []
    try {
      requirements = await loadAhjRequirements(context.supabase, job.ahj_id)
    } catch (reqErr) {
      console.warn('[contractor/jobs] ahj_document_requirements:', reqErr.message)
      requirements = []
    }

    const documentFolder = buildDocumentFolder(requirements, documents || [], job)

    const signedUrls = {}
    const pathsToSign = []

    if (job.noc_file_path) pathsToSign.push({ key: 'generated_noc', path: job.noc_file_path })
    const notarizedPath = job.job_specs?.proof?.notarized_file_path
    const recordedPath = job.job_specs?.erecord?.recorded_file_path
    if (notarizedPath) pathsToSign.push({ key: 'notarized_noc', path: notarizedPath })
    if (recordedPath) pathsToSign.push({ key: 'recorded_noc', path: recordedPath })

    // Sign folder documents that are available
    for (const row of documentFolder) {
      if (row.status === 'available' && row.document?.file_path && row.downloadKey) {
        pathsToSign.push({ key: row.downloadKey, path: row.document.file_path })
      }
    }

    // Combined packet (may not be in requirements list)
    const combined = findDocumentForRole(documents || [], 'combined_packet')
    if (combined?.file_path) {
      pathsToSign.push({ key: 'combined_packet', path: combined.file_path })
    }

    // Screenshots (legacy)
    const screenshotDocs = (documents || []).filter(d =>
      d.document_type?.includes('screenshot') || d.document_type === 'permit_screenshot'
    )
    for (const doc of screenshotDocs.slice(0, 10)) {
      if (doc.file_path) pathsToSign.push({ key: 'doc_' + doc.id, path: doc.file_path })
    }

    // Deduplicate keys
    const seen = new Set()
    for (const item of pathsToSign) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      const { data: signed } = await context.supabase.storage
        .from('job-documents')
        .createSignedUrl(item.path, 3600)
      if (signed?.signedUrl) signedUrls[item.key] = signed.signedUrl
    }

    return Response.json({
      job,
      documents: documents || [],
      documentFolder,
      logs: logs || [],
      downloadUrls: signedUrls,
      combinedPacketAvailable: Boolean(signedUrls.combined_packet),
    })
  } catch (err) {
    console.error('Get contractor job error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
