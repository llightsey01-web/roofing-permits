import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../../lib/workflow/admin-service.js')
}

/** POST /api/admin/workflows/[runId]/resume */
export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { runId } = await params
    const body = await request.json().catch(function () { return {} })
    const { resumeAdminRun } = loadAdmin()
    const run = await resumeAdminRun(runId, {
      reason: body.reason || 'admin resume',
      actorUserId: context.userId,
      completeCurrentStep: body.completeCurrentStep !== false,
      startFromStep: body.startFromStep || null,
      useLegacyBridge: body.useLegacyBridge !== false,
      dryRun: Boolean(body.dryRun),
      fromFailed: Boolean(body.fromFailed),
      stepOutput: body.stepOutput || {},
    })

    return Response.json({ success: true, run: run })
  } catch (err) {
    console.error('[admin/workflows/resume] error:', err.message)
    return Response.json({ error: err.message }, { status: err.status || 500 })
  }
}
