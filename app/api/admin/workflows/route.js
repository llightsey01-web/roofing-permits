import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../lib/workflow/admin-service.js')
}

/** GET /api/admin/workflows — list/filter durable workflow runs */
export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { searchParams } = new URL(request.url)
    const { listWorkflowRuns } = loadAdmin()
    const result = await listWorkflowRuns({
      status: searchParams.get('status') || 'all',
      workflowKey: searchParams.get('workflow_key') || searchParams.get('workflowKey') || 'all',
      jobId: searchParams.get('job_id') || searchParams.get('jobId') || null,
      companyId: searchParams.get('company_id') || searchParams.get('companyId') || null,
      q: searchParams.get('q') || null,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    })

    return Response.json(result)
  } catch (err) {
    console.error('[admin/workflows] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
