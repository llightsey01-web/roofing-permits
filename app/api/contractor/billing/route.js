import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'

const require = createRequire(import.meta.url)
const { getCompanyBillingDetail, mapInvoiceRow } = require('../../../../lib/billing/billing-report.js')

/**
 * GET /api/contractor/billing
 *
 * Company scoping (two layers):
 * 1) Application: company_id is taken ONLY from the authenticated session via
 *    requireCompanyUser → context.companyId. The request body/query cannot set it.
 * 2) RLS: past invoices are loaded with context.userSupabase (user JWT), which
 *    is subject to invoices_company_select (company_id = private.dartiq_current_company_id()).
 *    Accrual uses service-role helpers but is always called with that same
 *    verified context.companyId — never a client-supplied id.
 */
export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const detail = await getCompanyBillingDetail(context.companyId)

    // RLS-scoped invoice read (authenticated user client, not service role).
    const { data: invoiceRows, error: invoiceError } = await context.userSupabase
      .from('invoices')
      .select('*')
      .eq('company_id', context.companyId)
      .order('billing_period_start', { ascending: false })

    if (invoiceError) {
      console.error('[contractor/billing] RLS invoice read failed:', invoiceError.message)
      return Response.json({ error: 'Could not load invoices' }, { status: 500 })
    }

    const invoices = (invoiceRows || []).map(mapInvoiceRow)
    let latestOpen = null
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]
      if (inv.status === 'overdue' || inv.status === 'sent' || inv.status === 'draft') {
        latestOpen = inv
        break
      }
    }
    if (!latestOpen && invoices.length) latestOpen = invoices[0]

    return Response.json({
      ...detail,
      companyId: context.companyId,
      invoices: invoices,
      latestInvoice: latestOpen,
    })
  } catch (err) {
    console.error('[contractor/billing]', err.message)
    return Response.json({ error: err.message || 'Failed to load billing' }, { status: 500 })
  }
}
