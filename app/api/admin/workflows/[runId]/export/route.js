import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../../lib/workflow/admin-service.js')
}

/** GET /api/admin/workflows/[runId]/export — full run dump for support */
export async function GET(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { runId } = await params
    const { getWorkflowRunDetail } = loadAdmin()
    const detail = await getWorkflowRunDetail(runId, {
      eventLimit: 500,
      logLimit: 1000,
    })

    return new Response(JSON.stringify(detail, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="workflow-run-' + runId + '.json"',
      },
    })
  } catch (err) {
    console.error('[admin/workflows/export] error:', err.message)
    return Response.json({ error: err.message }, { status: err.status || 500 })
  }
}
