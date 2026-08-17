// lib/ahj/ahj-readiness.js
// ZIG-6: four-axis AHJ readiness policies (pure; no DB access).
// Axes: lifecycle_state, operational_health, is_active, workflow_type (+ workflow_file for portal).

'use strict'

var EXECUTABLE_LIFECYCLES = { pilot: true, production: true }
var RECOGNIZED_HEALTH = { healthy: true, degraded: true, unavailable: true }
var RECOGNIZED_WORKFLOW_TYPES = {
  portal: true,
  pdf_packet: true,
  hybrid: true,
  email: true,
}

function hasPortalRunner(row) {
  if (!row) return false
  // Non-portal recognized types: no completeness rule in ZIG-6 (future work).
  if (row.workflow_type !== 'portal') return true
  return row.workflow_file != null
}

/**
 * Fail closed unless every readiness input is present and recognized.
 * Shared by contractor visibility and worker execution (separate exports).
 */
function meetsSharedReadinessAxes(row) {
  if (!row) return false
  if (row.is_active !== true) return false
  if (!EXECUTABLE_LIFECYCLES[row.lifecycle_state]) return false
  if (!RECOGNIZED_HEALTH[row.operational_health]) return false
  if (row.operational_health === 'unavailable') return false
  if (!RECOGNIZED_WORKFLOW_TYPES[row.workflow_type]) return false
  if (!hasPortalRunner(row)) return false
  return true
}

/**
 * Contractor Settings credential-entry visibility.
 * Push-down equivalent lives in fetchContractorCredentialAhjs().
 */
function contractorCanSeeAhj(row) {
  return meetsSharedReadinessAxes(row)
}

/**
 * Worker permit-portal execution eligibility.
 * Kept as a separate export even when predicates match contractor visibility.
 */
function workerCanExecuteAhj(row) {
  return meetsSharedReadinessAxes(row)
}

function ahjNotExecutableError(ahj) {
  var name = ahj && ahj.name ? ahj.name : 'unknown'
  return Object.assign(
    new Error('AHJ is not executable under current readiness policy: ' + name),
    { errorCode: 'ahj_not_executable', nonRetryable: true }
  )
}

module.exports = {
  contractorCanSeeAhj,
  workerCanExecuteAhj,
  ahjNotExecutableError,
}
