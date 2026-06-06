// app/api/noc/start/route.js
// Starts the NOC phase for a job after parcel_number has been saved

const { runNocPhaseForJob } = require('../../../../lib/noc/run-noc-phase.js')
const { continueAfterNocGenerated } = require('../../../../lib/automation/noc-after-noc-core.js')
const { authenticateRequest, assertJobAccess } = require('../../../../lib/auth/session.js')
const { isInternalApiRequest } = require('../../../../lib/auth/internal-api.js')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function authorizeNocStart(request, jobId) {
  if (isInternalApiRequest(request)) {
    return { ok: true }
  }

  const context = await authenticateRequest(request)
  if (context.error) {
    return { ok: false, status: context.status, error: context.error }
  }

  if (context.isSuperAdmin) {
    return { ok: true }
  }

  const access = await assertJobAccess(context.supabase, jobId, context.companyId)
  if (access.error) {
    return { ok: false, status: access.status, error: access.error }
  }

  return { ok: true }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
    }

    let body
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
      ? Number(err.statusCode) || 500
      : 500
    console.error('NOC start error:', message)
    return jsonResponse({ error: message }, statusCode)
  }
}

export async function GET() {
  return jsonResponse({ error: 'Method not allowed. Use POST with { jobId }.' }, 405)
}
