import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/admin-service.js')
}

/** GET /api/admin/workflows/[runId] — run detail + timeline */
export async function GET(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { runId } = await params
    if (!runId) {
      return Response.json({ error: 'runId is required' }, { status: 400 })
    }

    const { getWorkflowRunDetail } = loadAdmin()
    const detail = await getWorkflowRunDetail(runId)
    return Response.json(detail)
  } catch (err) {
    console.error('[admin/workflows/:runId] GET error:', err.message)
    return Response.json(
      { error: err.message },
      { status: err.status || 500 }
    )
  }
}
