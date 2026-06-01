// app/api/noc/start/route.js
import { startNocPhaseForJob } from '../../../../lib/noc/start-noc.js'

export async function POST(request) {
  try {
    const body = await request.json()
    const result = await startNocPhaseForJob(body?.jobId)
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const statusCode = err?.statusCode || 500
    console.error('NOC start error:', message)
    return Response.json({ error: message }, { status: statusCode })
  }
}
