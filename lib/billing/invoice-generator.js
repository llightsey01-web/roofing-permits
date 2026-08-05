'use strict'

/**
 * Draft monthly invoice generation from billable issued-permit vendor costs.
 * Does not call Stripe, send email, or change invoice status past draft.
 *
 * SERVER-SIDE ONLY. Call from authenticated admin/worker paths with service-role.
 * Never import from client components.
 *
 * Billing rule: only jobs with job_status = 'permit_issued' (and permit_issued_at
 * in the period) contribute. Confirmed vendor_payments alone are DART's cost of
 * goods — not contractor billables until the county has issued the permit.
 */

var {
  getBillableIssuedPermitFeesForPeriod,
} = require('./vendor-ledger.js')

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('invoice-generator: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function assertUuid(value, label) {
  var s = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error('invoice-generator: ' + label + ' must be a uuid')
  }
  return s
}

function assertIso(value, label) {
  var s = String(value || '').trim()
  if (!s || Number.isNaN(Date.parse(s))) {
    throw new Error('invoice-generator: ' + label + ' must be a valid ISO timestamp')
  }
  return s
}

/**
 * Default due date: calendar date of billing_period_end (UTC) + netDays.
 * @param {string} periodEndIso
 * @param {number} [netDays=15]
 * @returns {string} YYYY-MM-DD
 */
function defaultDueDate(periodEndIso, netDays) {
  var days = typeof netDays === 'number' && Number.isInteger(netDays) && netDays >= 0 ? netDays : 15
  var d = new Date(periodEndIso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Create a draft invoice for a company billing period.
 *
 * permit_fees_total_cents =
 *   SUM(vendor_payments.amount_cents)
 *   WHERE vendor_payments.status = 'confirmed'
 *     AND jobs.job_status = 'permit_issued'
 *     AND jobs.permit_issued_at ∈ [billingPeriodStart, billingPeriodEnd)
 *     AND jobs.company_id = companyId
 *
 * subscription_amount_cents = 0 until pricing is decided (placeholder).
 *
 * @param {object} input
 * @param {string} input.companyId
 * @param {string} input.billingPeriodStart — inclusive ISO timestamptz
 * @param {string} input.billingPeriodEnd — exclusive ISO timestamptz
 * @param {string} [input.dueDate] — YYYY-MM-DD; default periodEnd + 15 days
 * @param {number} [input.subscriptionAmountCents=0]
 * @param {string} [input.currency='usd']
 * @returns {Promise<object>} inserted invoices row
 */
async function createDraftInvoice(input) {
  var opts = input || {}
  var companyId = assertUuid(opts.companyId, 'companyId')
  var periodStart = assertIso(opts.billingPeriodStart, 'billingPeriodStart')
  var periodEnd = assertIso(opts.billingPeriodEnd, 'billingPeriodEnd')
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw new Error('invoice-generator: billingPeriodEnd must be after billingPeriodStart')
  }

  var subscriptionAmountCents = opts.subscriptionAmountCents != null
    ? opts.subscriptionAmountCents
    : 0
  if (typeof subscriptionAmountCents !== 'number' || !Number.isInteger(subscriptionAmountCents) || subscriptionAmountCents < 0) {
    throw new Error('invoice-generator: subscriptionAmountCents must be a non-negative integer')
  }

  var dueDate = opts.dueDate
    ? String(opts.dueDate).trim()
    : defaultDueDate(periodEnd, 15)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('invoice-generator: dueDate must be YYYY-MM-DD')
  }

  var currency = (opts.currency ? String(opts.currency) : 'usd').trim().toLowerCase() || 'usd'

  // Issued-permit join — not a raw sum of all confirmed vendor_payments.
  var feeTotal = await getBillableIssuedPermitFeesForPeriod(companyId, periodStart, periodEnd, {
    currency: currency,
  })

  var supabase = getSupabase()
  var company = await supabase
    .from('companies')
    .select('id, subscription_plan')
    .eq('id', companyId)
    .single()
  if (company.error || !company.data) {
    throw new Error('invoice-generator: company not found: ' + companyId)
  }

  var row = {
    company_id: companyId,
    billing_period_start: periodStart,
    billing_period_end: periodEnd,
    permit_fees_total_cents: feeTotal.totalCents,
    subscription_amount_cents: subscriptionAmountCents,
    due_date: dueDate,
    status: 'draft',
    stripe_invoice_id: null,
  }

  var { data, error } = await supabase
    .from('invoices')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    throw new Error('invoice-generator: insert failed: ' + error.message)
  }

  return data
}

module.exports = {
  createDraftInvoice,
  defaultDueDate,
}
