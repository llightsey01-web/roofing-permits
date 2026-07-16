// GET /api/internal/health — detailed system health for monitoring dashboards
// NOTE: Prefer /api/health for Railway liveness probes. This route may return 503
// when the database is unreachable, which would incorrectly restart a healthy web process.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    // ?liveness=1 always returns 200 if this process can respond (safe for Railway)
    const livenessOnly = url.searchParams.get('liveness') === '1'

    if (livenessOnly) {
      return Response.json({
        ok: true,
        status: 'ok',
        mode: 'liveness',
        checkedAt: new Date().toISOString(),
      }, { status: 200 })
    }

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
