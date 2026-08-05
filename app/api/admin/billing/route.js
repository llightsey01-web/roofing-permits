import { createRequire } from 'module'
import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

const require = createRequire(import.meta.url)
const { getAdminBillingOverview } = require('../../../../lib/billing/billing-report.js')

/**
 * GET /api/admin/billing
 * Cross-company billing overview (super_admin only).
 */
export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const overview = await getAdminBillingOverview()
    return Response.json(overview)
  } catch (err) {
    console.error('[admin/billing]', err.message)
    return Response.json({ error: err.message || 'Failed to load billing overview' }, { status: 500 })
  }
}
