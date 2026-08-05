'use strict'

/**
 * Billing period helpers. Periods are half-open [start, end) in UTC,
 * matching getBillableIssuedPermitFeesForPeriod.
 */

/**
 * Current calendar month in UTC as [first-of-month, first-of-next-month).
 * @param {Date} [now]
 * @returns {{ periodStart: string, periodEnd: string, label: string }}
 */
function currentUtcMonthPeriod(now) {
  var d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  var y = d.getUTCFullYear()
  var m = d.getUTCMonth()
  var start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
  var end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))
  var label = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    label: label,
  }
}

/**
 * @param {string} periodStartIso
 * @param {string} periodEndIso
 * @returns {string}
 */
function formatPeriodLabel(periodStartIso, periodEndIso) {
  var start = new Date(periodStartIso)
  var endExclusive = new Date(periodEndIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    return String(periodStartIso || '') + ' – ' + String(periodEndIso || '')
  }
  var endInclusive = new Date(endExclusive.getTime() - 1)
  var opts = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
  return start.toLocaleDateString('en-US', opts) + ' – ' + endInclusive.toLocaleDateString('en-US', opts)
}

module.exports = {
  currentUtcMonthPeriod,
  formatPeriodLabel,
}
