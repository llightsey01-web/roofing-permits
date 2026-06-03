// app/api/noc/start/route.ts
// Starts the NOC phase for a job after parcel_number has been saved
import { runNocPhaseForJob } from '../../../../lib/noc/run-noc-phase.js'
import { authenticateRequest, assertJobAccess } from '../../../../lib/auth/session.js'
import { isInternalApiRequest } from '../../../../lib/auth/internal-api.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function authorizeNocStart(request: Request, jobId: string) {
  if (isInternalApiRequest(request)) {
    return { ok: true as const }
  }

  const context = await authenticateRequest(request)
  if (context.error) {
    return { ok: false as const, status: context.status, error: context.error }
  }

  if (context.isSuperAdmin) {
    return { ok: true as const }
  }

  const access = await assertJobAccess(context.supabase, jobId, context.companyId)
  if (access.error) {
    return { ok: false as const, status: access.status, error: access.error }
  }

  return { ok: true as const }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
    }

    let body: { jobId?: string }
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }

    const jobId = body?.jobId?.trim()
    if (!jobId) {
      return jsonResponse({ error: 'Job ID required' }, 400)
    }

    const auth = await authorizeNocStart(request, jobId)
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status)
    }

    const phase = await runNocPhaseForJob(jobId)
    const chainMod = await import('../../../../lib/automation/noc-after-noc-core.js')
    const continueAfterNocGenerated =
      chainMod.continueAfterNocGenerated ||
      (chainMod.default && chainMod.default.continueAfterNocGenerated)
    const chainResult = await continueAfterNocGenerated(jobId, { waitForProofCompletion: false })

    return jsonResponse({
      success: true,
      jobId: phase.jobId,
      status: phase.status,
      nocStatus: phase.nocStatus,
      nocFilePath: phase.nocFilePath,
      pipeline: phase.pipeline,
      chain: chainResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err
      ? Number((err as { statusCode?: number }).statusCode) || 500
      : 500
    console.error('NOC start error:', message)
    return jsonResponse({ error: message }, statusCode)
  }
}

export async function GET() {
  return jsonResponse({ error: 'Method not allowed. Use POST with { jobId }.' }, 405)
}
