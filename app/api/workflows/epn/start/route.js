import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

function loadEpn() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../workflows/epn-workflow.js')
}

function loadFlags() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../../lib/workflow/feature-flags.js')
}

/** POST /api/workflows/epn/start — start durable ePN workflow for a job */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const jobId = body.jobId || body.job_id
    if (!jobId) {
      return Response.json({ error: 'jobId is required' }, { status: 400 })
    }

    const flags = loadFlags()
    if (!flags.isWorkflowEngineEpnEnabled() && !body.force) {
      return Response.json(
        {
          error: 'WORKFLOW_ENGINE_EPN is not enabled. Set WORKFLOW_ENGINE_EPN=true or pass force=true.',
        },
        { status: 400 }
      )
    }

    const { startEpnWorkflow } = loadEpn()
    const result = await startEpnWorkflow({
      jobId: jobId,
      companyId: body.companyId || body.company_id || null,
      source: 'api',
      useLegacyBridge: body.useLegacyBridge !== false,
      dryRun: Boolean(body.dryRun),
      createdBy: context.userId,
      input: body.input || {},
    })

    return Response.json({
      success: true,
      run: result.run,
      steps: result.workflow.steps.map(function (s) {
        return { key: s.key, name: s.name, type: s.type }
      }),
    }, { status: 201 })
  } catch (err) {
    console.error('[workflows/epn/start] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
