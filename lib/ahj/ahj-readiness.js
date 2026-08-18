// lib/ahj/ahj-readiness.js
// ZIG-6: four-axis AHJ readiness policies (pure; no DB access).
// Axes: lifecycle_state, operational_health, is_active, workflow_type (+ workflow_file for portal).
// Reason helpers share the same evaluator as eligibility booleans.

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
 * Shared internal evaluator. Single source for eligibility + reason text.
 * Fail closed unless every readiness input is present and recognized.
 * @param {object|null|undefined} row
 * @returns {{
 *   eligible: boolean,
 *   reasons: string[],
 *   blocking_reason: string|null,
 *   axes: object
 * }}
 */
function _evaluateReadinessAxes(row) {
  var reasons = []
  var axes = {
    is_active: false,
    lifecycle_state: false,
    operational_health: false,
    workflow_type: false,
    workflow_file: false,
  }

  if (!row) {
    reasons.push('AHJ row is missing')
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'missing_row',
      axes: axes,
    }
  }

  if (row.is_active === true) {
    axes.is_active = true
  } else {
    reasons.push('AHJ is inactive')
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'inactive',
      axes: axes,
    }
  }

  if (EXECUTABLE_LIFECYCLES[row.lifecycle_state]) {
    axes.lifecycle_state = true
  } else {
    reasons.push(
      'lifecycle_state must be pilot or production (got ' +
        String(row.lifecycle_state == null ? 'missing' : row.lifecycle_state) +
        ')'
    )
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'lifecycle_not_executable',
      axes: axes,
    }
  }

  if (!RECOGNIZED_HEALTH[row.operational_health]) {
    reasons.push(
      'operational_health is missing or unrecognized (got ' +
        String(row.operational_health == null ? 'missing' : row.operational_health) +
        ')'
    )
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'health_unrecognized',
      axes: axes,
    }
  }
  if (row.operational_health === 'unavailable') {
    reasons.push('operational_health is unavailable')
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'unavailable',
      axes: axes,
    }
  }
  axes.operational_health = true

  if (!RECOGNIZED_WORKFLOW_TYPES[row.workflow_type]) {
    reasons.push(
      'workflow_type is missing or unrecognized (got ' +
        String(row.workflow_type == null ? 'missing' : row.workflow_type) +
        ')'
    )
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'workflow_unrecognized',
      axes: axes,
    }
  }
  axes.workflow_type = true

  if (!hasPortalRunner(row)) {
    reasons.push('portal workflow_type requires a non-null workflow_file')
    return {
      eligible: false,
      reasons: reasons,
      blocking_reason: 'missing_workflow_file',
      axes: axes,
    }
  }
  axes.workflow_file = true

  reasons.push('All ZIG-6 readiness axes pass')
  return {
    eligible: true,
    reasons: reasons,
    blocking_reason: null,
    axes: axes,
  }
}

/**
 * Contractor Settings credential-entry visibility.
 * Push-down equivalent lives in fetchContractorCredentialAhjs().
 */
function contractorCanSeeAhj(row) {
  return _evaluateReadinessAxes(row).eligible
}

/**
 * Worker permit-portal execution eligibility.
 * Kept as a separate export even when predicates match contractor visibility.
 */
function workerCanExecuteAhj(row) {
  return _evaluateReadinessAxes(row).eligible
}

/**
 * Explanatory companion to contractorCanSeeAhj — same evaluator.
 * @returns {{ visible: boolean, reasons: string[], blocking_reason: string|null }}
 */
function getContractorVisibilityReasons(ahj) {
  var ev = _evaluateReadinessAxes(ahj)
  return {
    visible: ev.eligible,
    reasons: ev.reasons.slice(),
    blocking_reason: ev.blocking_reason,
  }
}

/**
 * Explanatory companion to workerCanExecuteAhj — same evaluator.
 * @returns {{ executable: boolean, reasons: string[], blocking_reason: string|null }}
 */
function getWorkerExecutionReasons(ahj) {
  var ev = _evaluateReadinessAxes(ahj)
  return {
    executable: ev.eligible,
    reasons: ev.reasons.slice(),
    blocking_reason: ev.blocking_reason,
  }
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
  getContractorVisibilityReasons,
  getWorkerExecutionReasons,
  // Exported for dashboard/unit tests — not a public product API.
  _evaluateReadinessAxes: _evaluateReadinessAxes,
  EXECUTABLE_LIFECYCLES: EXECUTABLE_LIFECYCLES,
  RECOGNIZED_HEALTH: RECOGNIZED_HEALTH,
  RECOGNIZED_WORKFLOW_TYPES: RECOGNIZED_WORKFLOW_TYPES,
}
