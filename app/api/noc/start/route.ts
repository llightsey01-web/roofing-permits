// app/api/noc/start/route.ts
// Starts the NOC phase for a job after parcel_number has been saved
import { startNocPhaseForJob } from '../../../../lib/noc/start-noc.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

    const result = await startNocPhaseForJob(body?.jobId)
    return jsonResponse(result)
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
