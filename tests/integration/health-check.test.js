// tests/integration/health-check.test.js
// Exercises the same logic as GET /api/internal/health (route delegates to job-monitor)
'use strict'

const { getSystemHealthSnapshot } = require('../../lib/monitoring/job-monitor.js')

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

describe('internal health check', function () {
  test('health snapshot returns ok or degraded (not down) when database is up', async function () {
    if (!hasSupabase) {
      console.warn('[health-check.test] Skipping — Supabase env vars not set')
      return
    }

    const health = await getSystemHealthSnapshot({ sendAlerts: false })
    const httpStatus = health.status === 'down' ? 503 : 200

    expect(httpStatus).toBe(200)
    expect(health).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      workers: {
        permit: expect.any(Boolean),
        nocProof: expect.any(Boolean),
        ops: expect.any(Boolean),
      },
      database: true,
      checkedAt: expect.any(String),
    })
    expect(typeof health.stuckJobs).toBe('number')
    expect(typeof health.failedRunsLastHour).toBe('number')
  })
})
