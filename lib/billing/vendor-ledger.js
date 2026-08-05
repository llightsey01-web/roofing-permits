'use strict'

/**
 * Vendor cost ledger helpers — record / confirm / sum third-party payouts per job.
 * Schema: public.vendor_payments. No UI or payment execution in this module.
 *
 * SERVER-SIDE ONLY. RLS allows company users SELECT only; writes require service-role
 * (or super_admin). Every call to recordVendorPayment / confirmVendorPayment must go
 * through a server-side API route (or worker) that performs its own auth + tenant
 * checks first. Never import this module from client components, browser bundles, or
 * unauthenticated paths — that would bypass application auth while relying on the
 * service-role key.
 *
 * Known vendors (extensible): polk_county, onenotary, epn, lee_county, other
 * Known payment_types (extensible): permit_fee, notarization, recording_fee, surcharge, other
 * Status: pending | confirmed | failed
 * Money: amount_cents (integer). Callers convert dollars → cents explicitly.
 */

const { createClient } = require('@supabase/supabase-js')

var KNOWN_VENDORS = {
  polk_county: true,
  onenotary: true,
  epn: true,
  lee_county: true,
  other: true,
}

var KNOWN_PAYMENT_TYPES = {
  permit_fee: true,
  notarization: true,
  recording_fee: true,
  surcharge: true,
  other: true,
}

var KNOWN_STATUSES = {
  pending: true,
  confirmed: true,
  failed: true,
}

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('vendor-ledger: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('vendor-ledger: ' + label + ' is required')
  }
  return value.trim()
}

function assertUuid(value, label) {
  var s = assertNonEmptyString(value, label)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error('vendor-ledger: ' + label + ' must be a uuid')
  }
  return s
}

function assertAmountCents(amountCents) {
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('vendor-ledger: amount_cents must be a non-negative integer')
  }
  return amountCents
}

/**
 * Insert a pending (or explicitly status'd) vendor payment row.
 * @param {object} input
 * @param {string} input.jobId
 * @param {string} input.companyId
 * @param {string} input.vendor
 * @param {string} input.paymentType
 * @param {number} input.amountCents
 * @param {string} [input.currency='usd']
 * @param {string} [input.status='pending']
 * @param {string} [input.vendorReference]
 * @param {object} [input.metadata]
 * @returns {Promise<object>} inserted row
 */
async function recordVendorPayment(input) {
  var opts = input || {}
  var jobId = assertUuid(opts.jobId, 'jobId')
  var companyId = assertUuid(opts.companyId, 'companyId')
  var vendor = assertNonEmptyString(opts.vendor, 'vendor')
  var paymentType = assertNonEmptyString(opts.paymentType, 'paymentType')
  var amountCents = assertAmountCents(opts.amountCents)
  var currency = (opts.currency ? String(opts.currency) : 'usd').trim().toLowerCase() || 'usd'
  var status = opts.status ? assertNonEmptyString(opts.status, 'status') : 'pending'
  var vendorReference = opts.vendorReference != null ? String(opts.vendorReference).trim() || null : null
  var metadata = opts.metadata && typeof opts.metadata === 'object' && !Array.isArray(opts.metadata)
    ? opts.metadata
    : {}

  if (!KNOWN_VENDORS[vendor]) {
    throw new Error('vendor-ledger: unknown vendor "' + vendor + '"')
  }
  if (!KNOWN_PAYMENT_TYPES[paymentType]) {
    throw new Error('vendor-ledger: unknown paymentType "' + paymentType + '"')
  }
  if (!KNOWN_STATUSES[status]) {
    throw new Error('vendor-ledger: unknown status "' + status + '"')
  }
  if (status === 'confirmed') {
    throw new Error('vendor-ledger: use confirmVendorPayment() to confirm a row')
  }

  var supabase = getSupabase()
  var row = {
    job_id: jobId,
    company_id: companyId,
    vendor: vendor,
    payment_type: paymentType,
    amount_cents: amountCents,
    currency: currency,
    status: status,
    vendor_reference: vendorReference,
    metadata: metadata,
  }

  var { data, error } = await supabase
    .from('vendor_payments')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    throw new Error('vendor-ledger: record failed: ' + error.message)
  }
  return data
}

/**
 * Mark a vendor payment confirmed (attestation / Stage 3 manual confirm path).
 * @param {object} input
 * @param {string} input.paymentId
 * @param {string} input.confirmedBy — users.id
 * @param {string} [input.vendorReference]
 * @param {object} [input.metadataMerge] — shallow-merged into existing metadata
 * @returns {Promise<object>} updated row
 */
async function confirmVendorPayment(input) {
  var opts = input || {}
  var paymentId = assertUuid(opts.paymentId, 'paymentId')
  var confirmedBy = assertUuid(opts.confirmedBy, 'confirmedBy')
  var vendorReference = opts.vendorReference != null ? String(opts.vendorReference).trim() || null : undefined

  var supabase = getSupabase()
  var existing = await supabase
    .from('vendor_payments')
    .select('*')
    .eq('id', paymentId)
    .single()

  if (existing.error || !existing.data) {
    throw new Error('vendor-ledger: payment not found: ' + paymentId)
  }
  if (existing.data.status === 'confirmed') {
    return existing.data
  }
  if (existing.data.status === 'failed') {
    throw new Error('vendor-ledger: cannot confirm a failed payment')
  }

  var metadata = existing.data.metadata && typeof existing.data.metadata === 'object'
    ? Object.assign({}, existing.data.metadata)
    : {}
  if (opts.metadataMerge && typeof opts.metadataMerge === 'object') {
    Object.assign(metadata, opts.metadataMerge)
  }

  var patch = {
    status: 'confirmed',
    confirmed_by: confirmedBy,
    confirmed_at: new Date().toISOString(),
    metadata: metadata,
  }
  if (vendorReference !== undefined) {
    patch.vendor_reference = vendorReference
  }

  var { data, error } = await supabase
    .from('vendor_payments')
    .update(patch)
    .eq('id', paymentId)
    .select('*')
    .single()

  if (error) {
    throw new Error('vendor-ledger: confirm failed: ' + error.message)
  }
  return data
}

/**
 * Sum confirmed vendor payments for a job (integer cents).
 * @param {string} jobId
 * @param {object} [options]
 * @param {string} [options.currency='usd']
 * @returns {Promise<{ jobId: string, currency: string, totalCents: number, count: number, rows: object[] }>}
 */
async function getJobVendorCostTotal(jobId, options) {
  var id = assertUuid(jobId, 'jobId')
  var opts = options || {}
  var currency = (opts.currency ? String(opts.currency) : 'usd').trim().toLowerCase() || 'usd'

  var supabase = getSupabase()
  var { data, error } = await supabase
    .from('vendor_payments')
    .select('*')
    .eq('job_id', id)
    .eq('status', 'confirmed')
    .eq('currency', currency)

  if (error) {
    throw new Error('vendor-ledger: total query failed: ' + error.message)
  }

  var rows = data || []
  var totalCents = 0
  for (var i = 0; i < rows.length; i++) {
    totalCents += Number(rows[i].amount_cents) || 0
  }

  return {
    jobId: id,
    currency: currency,
    totalCents: totalCents,
    count: rows.length,
    rows: rows,
  }
}

/**
 * Sum confirmed vendor payments for a company within a billing period (integer cents).
 * Attribution: confirmed_at when set, else created_at.
 * Period is [periodStart, periodEnd) in ISO timestamps.
 *
 * NOTE: This does NOT filter by permit issuance. For contractor invoicing use
 * getBillableIssuedPermitFeesForPeriod() instead — confirmed vendor spend alone
 * is not billable until jobs.job_status = 'permit_issued'.
 *
 * @param {string} companyId
 * @param {string} periodStart — inclusive ISO timestamptz
 * @param {string} periodEnd — exclusive ISO timestamptz
 * @param {object} [options]
 * @param {string} [options.currency='usd']
 * @returns {Promise<{ companyId: string, currency: string, totalCents: number, count: number, rows: object[] }>}
 */
async function getCompanyVendorCostTotalForPeriod(companyId, periodStart, periodEnd, options) {
  var id = assertUuid(companyId, 'companyId')
  var start = assertNonEmptyString(periodStart, 'periodStart')
  var end = assertNonEmptyString(periodEnd, 'periodEnd')
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new Error('vendor-ledger: periodStart/periodEnd must be valid ISO timestamps')
  }
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error('vendor-ledger: periodEnd must be after periodStart')
  }
  var opts = options || {}
  var currency = (opts.currency ? String(opts.currency) : 'usd').trim().toLowerCase() || 'usd'

  var supabase = getSupabase()
  var { data, error } = await supabase
    .from('vendor_payments')
    .select('*')
    .eq('company_id', id)
    .eq('status', 'confirmed')
    .eq('currency', currency)

  if (error) {
    throw new Error('vendor-ledger: company period total query failed: ' + error.message)
  }

  var startMs = Date.parse(start)
  var endMs = Date.parse(end)
  var rows = (data || []).filter(function (row) {
    var stamp = row.confirmed_at || row.created_at
    var ms = Date.parse(stamp)
    return !Number.isNaN(ms) && ms >= startMs && ms < endMs
  })

  var totalCents = 0
  for (var i = 0; i < rows.length; i++) {
    totalCents += Number(rows[i].amount_cents) || 0
  }

  return {
    companyId: id,
    currency: currency,
    periodStart: start,
    periodEnd: end,
    totalCents: totalCents,
    count: rows.length,
    rows: rows,
  }
}

/**
 * Billable permit fees for a company billing period (integer cents).
 *
 * Business rule: contractors are billed only after the county has approved/issued
 * the permit. A confirmed vendor_payments row means DART iQ paid the vendor — it
 * does NOT mean the permit is approved. Unbilled vendor costs on unissued jobs
 * intentionally carry across periods.
 *
 * Join (explicit):
 *   1) jobs where company_id = X AND job_status = 'permit_issued'
 *      AND permit_issued_at ∈ [periodStart, periodEnd)
 *   2) vendor_payments where status = 'confirmed' AND job_id IN (those jobs)
 *      AND currency matches
 *
 * Period attribution uses jobs.permit_issued_at (set by Mark Permit Issued),
 * not vendor_payments.confirmed_at.
 *
 * @param {string} companyId
 * @param {string} periodStart — inclusive ISO timestamptz
 * @param {string} periodEnd — exclusive ISO timestamptz
 * @param {object} [options]
 * @param {string} [options.currency='usd']
 * @returns {Promise<object>}
 */
async function getBillableIssuedPermitFeesForPeriod(companyId, periodStart, periodEnd, options) {
  var id = assertUuid(companyId, 'companyId')
  var start = assertNonEmptyString(periodStart, 'periodStart')
  var end = assertNonEmptyString(periodEnd, 'periodEnd')
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new Error('vendor-ledger: periodStart/periodEnd must be valid ISO timestamps')
  }
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error('vendor-ledger: periodEnd must be after periodStart')
  }
  var opts = options || {}
  var currency = (opts.currency ? String(opts.currency) : 'usd').trim().toLowerCase() || 'usd'

  var supabase = getSupabase()

  // Step 1 — issued jobs whose issuance falls in this billing period.
  var issued = await supabase
    .from('jobs')
    .select('id, permit_issued_at, job_status, property_address, property_city, property_state, property_zip, permit_number, owner_name')
    .eq('company_id', id)
    .eq('job_status', 'permit_issued')
    .not('permit_issued_at', 'is', null)
    .gte('permit_issued_at', start)
    .lt('permit_issued_at', end)
    .order('permit_issued_at', { ascending: false })

  if (issued.error) {
    throw new Error('vendor-ledger: issued jobs query failed: ' + issued.error.message)
  }

  var issuedJobs = issued.data || []
  var jobIds = issuedJobs.map(function (j) { return j.id })
  if (jobIds.length === 0) {
    return {
      companyId: id,
      currency: currency,
      periodStart: start,
      periodEnd: end,
      totalCents: 0,
      issuedJobCount: 0,
      paymentCount: 0,
      issuedJobIds: [],
      issuedJobs: [],
      jobs: [],
      rows: [],
    }
  }

  // Step 2 — confirmed vendor payouts on those issued jobs only (not all confirmed spend).
  var payments = await supabase
    .from('vendor_payments')
    .select('*')
    .eq('company_id', id)
    .eq('status', 'confirmed')
    .eq('currency', currency)
    .in('job_id', jobIds)

  if (payments.error) {
    throw new Error('vendor-ledger: billable payments query failed: ' + payments.error.message)
  }

  var rows = payments.data || []
  var totalCents = 0
  for (var i = 0; i < rows.length; i++) {
    totalCents += Number(rows[i].amount_cents) || 0
  }

  var jobs = buildIssuedJobBreakdown(issuedJobs, rows)

  return {
    companyId: id,
    currency: currency,
    periodStart: start,
    periodEnd: end,
    totalCents: totalCents,
    issuedJobCount: jobIds.length,
    paymentCount: rows.length,
    issuedJobIds: jobIds,
    issuedJobs: issuedJobs,
    jobs: jobs,
    rows: rows,
  }
}

/**
 * Group confirmed payment rows under their issued jobs for UI breakdowns.
 * @param {object[]} issuedJobs
 * @param {object[]} paymentRows
 * @returns {object[]}
 */
function buildIssuedJobBreakdown(issuedJobs, paymentRows) {
  var byJob = {}
  for (var p = 0; p < (paymentRows || []).length; p++) {
    var row = paymentRows[p]
    var jid = row.job_id
    if (!byJob[jid]) byJob[jid] = []
    byJob[jid].push({
      id: row.id,
      vendor: row.vendor,
      paymentType: row.payment_type,
      amountCents: Number(row.amount_cents) || 0,
      currency: row.currency,
      confirmedAt: row.confirmed_at || null,
      vendorReference: row.vendor_reference || null,
    })
  }

  return (issuedJobs || []).map(function (job) {
    var payments = byJob[job.id] || []
    var jobTotal = 0
    for (var i = 0; i < payments.length; i++) {
      jobTotal += payments[i].amountCents
    }
    return {
      jobId: job.id,
      propertyAddress: job.property_address || null,
      propertyCity: job.property_city || null,
      propertyState: job.property_state || null,
      propertyZip: job.property_zip || null,
      permitNumber: job.permit_number || null,
      ownerName: job.owner_name || null,
      permitIssuedAt: job.permit_issued_at || null,
      totalCents: jobTotal,
      payments: payments,
    }
  })
}

module.exports = {
  KNOWN_VENDORS,
  KNOWN_PAYMENT_TYPES,
  KNOWN_STATUSES,
  recordVendorPayment,
  confirmVendorPayment,
  getJobVendorCostTotal,
  getCompanyVendorCostTotalForPeriod,
  getBillableIssuedPermitFeesForPeriod,
  buildIssuedJobBreakdown,
}
