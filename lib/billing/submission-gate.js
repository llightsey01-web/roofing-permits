'use strict'

/**
 * Contractor new-permit submission gate based on overdue invoices.
 *
 * Fail closed: DB errors / ambiguous state => blocked (same philosophy as
 * lib/automation/automation-gate.js).
 *
 * Scope: NEW permit submissions only. Do not use to pause in-progress jobs.
 *
 * SERVER-SIDE ONLY — call from authenticated API routes / workers.
 */

const { createClient } = require('@supabase/supabase-js')

/** Days after due_date that an overdue invoice blocks new submissions. */
var OVERDUE_SHUTOFF_DAYS = 15

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('submission-gate: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function assertUuid(value, label) {
  var s = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error('submission-gate: ' + label + ' must be a uuid')
  }
  return s
}

/**
 * @param {string} companyId
 * @param {object} [options]
 * @param {Date} [options.now] — injectable clock for tests
 * @returns {Promise<{ allowed: boolean, reason: string|null, blockingInvoiceIds: string[] }>}
 */
async function canCompanySubmitNewPermit(companyId, options) {
  var opts = options || {}
  try {
    var id = assertUuid(companyId, 'companyId')
    var now = opts.now instanceof Date ? opts.now : new Date()
    if (Number.isNaN(now.getTime())) {
      console.warn('[submission-gate] invalid now — treating as blocked')
      return {
        allowed: false,
        reason: 'Billing status could not be verified. New permit submissions are temporarily blocked.',
        blockingInvoiceIds: [],
      }
    }

    var cutoff = new Date(now.getTime())
    cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_SHUTOFF_DAYS)
    var cutoffDate = cutoff.toISOString().slice(0, 10)

    var supabase = getSupabase()
    var { data, error } = await supabase
      .from('invoices')
      .select('id, due_date, status')
      .eq('company_id', id)
      .eq('status', 'overdue')
      .lt('due_date', cutoffDate)

    if (error) {
      console.warn('[submission-gate] lookup failed — treating as blocked:', error.message)
      return {
        allowed: false,
        reason: 'Billing status could not be verified. New permit submissions are temporarily blocked.',
        blockingInvoiceIds: [],
      }
    }

    var rows = data || []
    if (rows.length === 0) {
      return { allowed: true, reason: null, blockingInvoiceIds: [] }
    }

    return {
      allowed: false,
      reason:
        'New permit submissions are blocked because one or more invoices are more than ' +
        OVERDUE_SHUTOFF_DAYS +
        ' days past due. Contact support to restore access after payment.',
      blockingInvoiceIds: rows.map(function (r) { return r.id }),
    }
  } catch (err) {
    console.warn('[submission-gate] error — treating as blocked:', err && err.message)
    return {
      allowed: false,
      reason: 'Billing status could not be verified. New permit submissions are temporarily blocked.',
      blockingInvoiceIds: [],
    }
  }
}

module.exports = {
  OVERDUE_SHUTOFF_DAYS,
  canCompanySubmitNewPermit,
}
