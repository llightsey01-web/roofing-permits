import { authenticateRequest, requireCompanyUser, assertJobAccess } from '../../../../../../lib/auth/session.js'
import { createClient } from '../../../../../../lib/supabase-server.js'

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
      .select('id, company_id, noc_file_path, noc_option, noc_status')
      .eq('id', id)
      .eq('company_id', context.companyId)
      .single()

    if (jobError || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!job.noc_file_path) {
      return Response.json({ error: 'NOC PDF is not ready yet' }, { status: 404 })
    }

    const supabase = createClient()
    const { data: signed, error: signError } = await supabase.storage
      .from('job-documents')
      .createSignedUrl(job.noc_file_path, 3600)

    if (signError || !signed?.signedUrl) {
      return Response.json({ error: signError?.message || 'Failed to create download URL' }, { status: 500 })
    }

    return Response.json({
      url: signed.signedUrl,
      path: job.noc_file_path,
      noc_option: job.noc_option,
      noc_status: job.noc_status,
    })
  } catch (err) {
    console.error('[download-noc] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
