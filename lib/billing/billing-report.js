'use strict'

/**
 * Read-only billing report builders for contractor + admin portals.
 * No Stripe calls, no status mutations.
 *
 * SERVER-SIDE ONLY — callers must authenticate and pass a verified companyId
 * (contractor) or require super_admin (admin cross-company).
 */

var {
  getBillableIssuedPermitFeesForPeriod,
  getCompanyVendorCostTotalForPeriod,
} = require('./vendor-ledger.js')
var { currentUtcMonthPeriod, formatPeriodLabel } = require('./period.js')
var {
  OVERDUE_SHUTOFF_DAYS,
  canCompanySubmitNewPermit,
} = require('./submission-gate.js')

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('billing-report: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function assertUuid(value, label) {
  var s = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error('billing-report: ' + label + ' must be a uuid')
  }
  return s
}

function utcDateOnly(d) {
  return d.toISOString().slice(0, 10)
}

/**
 * Shutoff metadata for an invoice, reusing OVERDUE_SHUTOFF_DAYS from submission-gate.
 * Blocked when status=overdue AND due_date < (todayUTC - OVERDUE_SHUTOFF_DAYS) —
 * same comparison as canCompanySubmitNewPermit.
 *
 * @param {object|null} invoice
 * @param {Date} [now]
 * @returns {object}
 */
function describeInvoiceShutoff(invoice, now) {
  var clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  var today = utcDateOnly(clock)
  var cutoff = new Date(clock.getTime())
  cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_SHUTOFF_DAYS)
  var cutoffDate = utcDateOnly(cutoff)

  if (!invoice || !invoice.due_date) {
    return {
      dueDate: null,
      daysPastDue: null,
      daysUntilDue: null,
      shutoffBlocked: false,
      shutoffApproaching: false,
      shutoffCutoffDate: cutoffDate,
      shutoffDays: OVERDUE_SHUTOFF_DAYS,
    }
  }

  var due = String(invoice.due_date).slice(0, 10)
  var dueMs = Date.parse(due + 'T00:00:00.000Z')
  var todayMs = Date.parse(today + 'T00:00:00.000Z')
  var daysPastDue = null
  var daysUntilDue = null
  if (!Number.isNaN(dueMs) && !Number.isNaN(todayMs)) {
    var diffDays = Math.round((todayMs - dueMs) / 86400000)
    if (diffDays > 0) daysPastDue = diffDays
    else daysUntilDue = -diffDays
  }

  var isOverdue = invoice.status === 'overdue'
  var shutoffBlocked = isOverdue && due < cutoffDate
  var shutoffApproaching = isOverdue && !shutoffBlocked

  return {
    dueDate: due,
    daysPastDue: daysPastDue,
    daysUntilDue: daysUntilDue,
    shutoffBlocked: shutoffBlocked,
    shutoffApproaching: shutoffApproaching,
    shutoffCutoffDate: cutoffDate,
    shutoffDays: OVERDUE_SHUTOFF_DAYS,
  }
}

function mapInvoiceRow(row) {
  if (!row) return null
  return {
    id: row.id,
    companyId: row.company_id,
    billingPeriodStart: row.billing_period_start,
    billingPeriodEnd: row.billing_period_end,
    billingPeriodLabel: formatPeriodLabel(row.billing_period_start, row.billing_period_end),
    permitFeesTotalCents: row.permit_fees_total_cents,
    subscriptionAmountCents: row.subscription_amount_cents,
    totalCents: row.total_cents,
    dueDate: row.due_date,
    status: row.status,
    paidAt: row.paid_at,
    stripeInvoiceId: row.stripe_invoice_id,
    createdAt: row.created_at,
    shutoff: describeInvoiceShutoff(row),
  }
}

/**
 * List invoices for a company (newest first). Service-role; caller must authorize.
 * @param {string} companyId
 * @returns {Promise<object[]>}
 */
async function listCompanyInvoices(companyId) {
  var id = assertUuid(companyId, 'companyId')
  var supabase = getSupabase()
  var { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('company_id', id)
    .order('billing_period_start', { ascending: false })

  if (error) {
    throw new Error('billing-report: invoices query failed: ' + error.message)
  }
  return (data || []).map(mapInvoiceRow)
}

/**
 * Full company billing detail for contractor tab / admin drill-down.
 * @param {string} companyId
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<object>}
 */
async function getCompanyBillingDetail(companyId, options) {
  var id = assertUuid(companyId, 'companyId')
  var opts = options || {}
  var now = opts.now instanceof Date ? opts.now : new Date()
  var period = currentUtcMonthPeriod(now)

  var supabase = getSupabase()
  var companyRes = await supabase
    .from('companies')
    .select('id, name, dba_name, subscription_plan, subscription_status, is_active')
    .eq('id', id)
    .single()
  if (companyRes.error || !companyRes.data) {
    throw new Error('billing-report: company not found: ' + id)
  }

  var [accrual, invoices, submissionGate] = await Promise.all([
    getBillableIssuedPermitFeesForPeriod(id, period.periodStart, period.periodEnd),
    listCompanyInvoices(id),
    canCompanySubmitNewPermit(id, { now: now }),
  ])

  var latestOpen = null
  for (var i = 0; i < invoices.length; i++) {
    var inv = invoices[i]
    if (inv.status === 'overdue' || inv.status === 'sent' || inv.status === 'draft') {
      latestOpen = inv
      break
    }
  }
  if (!latestOpen && invoices.length) latestOpen = invoices[0]

  return {
    company: {
      id: companyRes.data.id,
      name: companyRes.data.name,
      dbaName: companyRes.data.dba_name || null,
      subscriptionPlan: companyRes.data.subscription_plan || null,
      subscriptionStatus: companyRes.data.subscription_status || null,
      isActive: companyRes.data.is_active !== false,
    },
    period: {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      label: period.label,
    },
    accrual: {
      label: 'Current period estimate',
      note:
        'Running total of confirmed vendor fees on permits issued this period. ' +
        'Not a finalized invoice — Stripe will create invoices at period close.',
      totalCents: accrual.totalCents,
      issuedJobCount: accrual.issuedJobCount,
      paymentCount: accrual.paymentCount,
      currency: accrual.currency,
      jobs: accrual.jobs || [],
    },
    invoices: invoices,
    latestInvoice: latestOpen,
    submissionGate: submissionGate,
    shutoffDays: OVERDUE_SHUTOFF_DAYS,
  }
}

/**
 * Admin cross-company billing overview for the current UTC month.
 * @param {object} [options]
 * @param {Date} [options.now]
 * @returns {Promise<object>}
 */
async function getAdminBillingOverview(options) {
  var opts = options || {}
  var now = opts.now instanceof Date ? opts.now : new Date()
  var period = currentUtcMonthPeriod(now)
  var supabase = getSupabase()

  var companiesRes = await supabase
    .from('companies')
    .select('id, name, dba_name, subscription_plan, subscription_status, is_active')
    .order('name', { ascending: true })

  if (companiesRes.error) {
    throw new Error('billing-report: companies query failed: ' + companiesRes.error.message)
  }

  var companies = companiesRes.data || []
  var rows = []
  var accruedRevenueCents = 0
  var dartVendorCostCents = 0

  // Sequential to avoid bursting service-role connections; company counts are modest.
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i]
    var [accrual, cost, invoices, gate] = await Promise.all([
      getBillableIssuedPermitFeesForPeriod(c.id, period.periodStart, period.periodEnd),
      getCompanyVendorCostTotalForPeriod(c.id, period.periodStart, period.periodEnd),
      listCompanyInvoices(c.id),
      canCompanySubmitNewPermit(c.id, { now: now }),
    ])

    accruedRevenueCents += accrual.totalCents
    dartVendorCostCents += cost.totalCents

    var latest = invoices.length ? invoices[0] : null
    var shutoff = latest ? latest.shutoff : describeInvoiceShutoff(null, now)

    rows.push({
      companyId: c.id,
      companyName: c.name,
      dbaName: c.dba_name || null,
      subscriptionPlan: c.subscription_plan || null,
      subscriptionStatus: c.subscription_status || null,
      isActive: c.is_active !== false,
      currentPeriodAccrualCents: accrual.totalCents,
      currentPeriodVendorCostCents: cost.totalCents,
      issuedJobCount: accrual.issuedJobCount,
      latestInvoice: latest,
      shutoff: shutoff,
      submissionAllowed: gate.allowed,
      submissionGateReason: gate.reason,
    })
  }

  return {
    period: {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      label: period.label,
    },
    aggregates: {
      accruedRevenueCents: accruedRevenueCents,
      accruedRevenueNote:
        'Sum of confirmed vendor fees on issued permits this period (billable to contractors).',
      dartVendorCostCents: dartVendorCostCents,
      dartVendorCostNote:
        'Sum of all confirmed vendor_payments this period by confirmation date — DART iQ cost of goods, ' +
        'including fees on permits not yet issued. Not the same as accrued revenue.',
      companyCount: companies.length,
    },
    shutoffDays: OVERDUE_SHUTOFF_DAYS,
    companies: rows,
  }
}

module.exports = {
  describeInvoiceShutoff,
  listCompanyInvoices,
  getCompanyBillingDetail,
  getAdminBillingOverview,
  mapInvoiceRow,
}
