// GET /api/internal/health — system health for Railway and monitoring

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const { getSystemHealthSnapshot } = await import('../../../../lib/monitoring/job-monitor.js')
    const health = await getSystemHealthSnapshot({ sendAlerts: false })

    const httpStatus = health.status === 'down' ? 503 : 200

    return Response.json(health, { status: httpStatus })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[internal/health] Error:', message)
    return Response.json(
      {
        status: 'down',
        workers: { permit: false, nocProof: false, ops: false },
        database: false,
        lastRunAt: null,
        stuckJobs: 0,
        failedRunsLastHour: 0,
        error: message,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
