import { createRequire } from 'module'
import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

const require = createRequire(import.meta.url)
const { getCompanyBillingDetail } = require('../../../../../lib/billing/billing-report.js')

/**
 * GET /api/admin/billing/[companyId]
 * Admin drill-down into one company's billing detail.
 */
export async function GET(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const resolved = typeof params?.then === 'function' ? await params : params
    const companyId = String(resolved?.companyId || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
      return Response.json({ error: 'Valid companyId is required' }, { status: 400 })
    }

    const detail = await getCompanyBillingDetail(companyId)
    return Response.json(detail)
  } catch (err) {
    console.error('[admin/billing/company]', err.message)
    return Response.json({ error: err.message || 'Failed to load company billing' }, { status: 500 })
  }
}
