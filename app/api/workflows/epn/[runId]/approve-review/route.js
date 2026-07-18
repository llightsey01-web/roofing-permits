import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadEpn() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../../workflows/epn-workflow.js')
}

/** POST /api/workflows/epn/[runId]/approve-review — approve human gate after prepare */
export async function POST(request, { params }) {
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

    const body = await request.json().catch(function () { return {} })
    const { approveEpnReview } = loadEpn()
    const run = await approveEpnReview(runId, {
      reason: body.reason || 'admin approved eRecord review',
      actorUserId: context.userId,
      source: 'admin',
      useLegacyBridge: body.useLegacyBridge !== false,
      dryRun: Boolean(body.dryRun),
    })

    return Response.json({ success: true, run: run })
  } catch (err) {
    console.error('[workflows/epn/approve-review] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
