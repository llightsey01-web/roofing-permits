// app/api/noc/start/route.ts
// Queues NOC generation — worker picks up the run and executes automation
import { createClient } from '../../../../lib/supabase-server.js'
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
    return { ok: true as const, supabase: createClient() }
  }

  const context = await authenticateRequest(request)
  if (context.error) {
    return { ok: false as const, status: context.status, error: context.error }
  }

  if (!context.isSuperAdmin) {
    const access = await assertJobAccess(context.supabase, jobId, context.companyId)
    if (access.error) {
      return { ok: false as const, status: access.status, error: access.error }
    }
  }

  return { ok: true as const, supabase: context.supabase }
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

    const { data: job, error: jobError } = await auth.supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .maybeSingle()

    if (jobError) {
      return jsonResponse({ error: 'Job lookup failed' }, 500)
    }
    if (!job) {
      return jsonResponse({ error: 'Job not found' }, 404)
    }

    const { data: run, error: runError } = await auth.supabase
      .from('automation_runs')
      .insert({
        job_id: jobId,
        run_type: 'noc_generate',
        run_status: 'queued',
        started_at: new Date().toISOString(),
        attempts: 0,
      })
      .select('id')
      .single()

    if (runError) {
      console.error('NOC start queue error:', runError.message)
      return jsonResponse({ error: 'Failed to queue NOC generation: ' + runError.message }, 500)
    }

    await auth.supabase
      .from('jobs')
      .update({ job_status: 'automation_running' })
      .eq('id', jobId)

    return jsonResponse({
      success: true,
      jobId,
      runId: run.id,
      status: 'queued',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('NOC start error:', message)
    return jsonResponse({ error: message }, 500)
  }
}

export async function GET() {
  return jsonResponse({ error: 'Method not allowed. Use POST with { jobId }.' }, 405)
}
