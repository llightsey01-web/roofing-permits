import { createRequire } from 'module'
import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

const require = createRequire(import.meta.url)
const { computeSystemMetrics } = require('../../../../lib/monitoring/platform-metrics.js')

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const metrics = await computeSystemMetrics(context.supabase)
    return Response.json(metrics)
  } catch (err) {
    console.error('[admin/system-metrics] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
