// lib/automation/run-status.js
// Canonical automation_runs.run_status writer contract + reader semantics.
//
// Writer contract: values only. Does not interpret success, dashboards,
// recovery, or schema. Historical aliases are reader-only, never writers.
//
// Reader contract: classification for metrics/UI/workflow. Historical
// aliases are read-only and must never be written by canonical writers.

'use strict'

var RUN_STATUS_QUEUED = 'queued'
var RUN_STATUS_RUNNING = 'running'
var RUN_STATUS_COMPLETE = 'complete'
var RUN_STATUS_NEEDS_REVIEW = 'needs_review'
var RUN_STATUS_ERROR = 'error'
var RUN_STATUS_CANCELLED = 'cancelled'

var CANONICAL_RUN_STATUSES = Object.freeze([
  RUN_STATUS_QUEUED,
  RUN_STATUS_RUNNING,
  RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR,
  RUN_STATUS_CANCELLED,
])

var CANONICAL_RUN_STATUS_SET = Object.freeze({
  queued: true,
  running: true,
  complete: true,
  needs_review: true,
  error: true,
  cancelled: true,
})

// ---------------------------------------------------------------------------
// Reader-only compatibility. Not part of the writer contract.
// completed = historical success alias. failed = historical failure alias.
// submitted is a job lifecycle state and is never automation-run success.
// ---------------------------------------------------------------------------

var HISTORICAL_SUCCESS_ALIAS = 'completed'
var HISTORICAL_FAILURE_ALIAS = 'failed'

var SUCCESS_READ_STATUSES = Object.freeze([
  RUN_STATUS_COMPLETE,
  HISTORICAL_SUCCESS_ALIAS,
])

var INTERVENTION_READ_STATUSES = Object.freeze([
  RUN_STATUS_NEEDS_REVIEW,
])

var FAILURE_READ_STATUSES = Object.freeze([
  RUN_STATUS_ERROR,
  HISTORICAL_FAILURE_ALIAS,
])

var CANCELLED_READ_STATUSES = Object.freeze([
  RUN_STATUS_CANCELLED,
])

var ACTIVE_READ_STATUSES = Object.freeze([
  RUN_STATUS_QUEUED,
  RUN_STATUS_RUNNING,
])

var TERMINAL_READ_STATUSES = Object.freeze([
  RUN_STATUS_COMPLETE,
  HISTORICAL_SUCCESS_ALIAS,
  RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR,
  HISTORICAL_FAILURE_ALIAS,
  RUN_STATUS_CANCELLED,
])

var RUN_STATUS_KIND = Object.freeze({
  SUCCESS: 'success',
  INTERVENTION: 'intervention',
  FAILURE: 'failure',
  CANCELLED: 'cancelled',
  QUEUED: 'queued',
  RUNNING: 'running',
  UNKNOWN: 'unknown',
})

var RUN_STATUS_LABELS = Object.freeze({
  success: 'Success',
  intervention: 'Needs review',
  failure: 'Failed',
  cancelled: 'Cancelled',
  queued: 'Queued',
  running: 'Running',
  unknown: 'Unknown',
})

// workflow_activities.status CHECK: queued, claimed, running, succeeded,
// failed, cancelled. There is no needs_review activity value, so terminal
// intervention maps to failed (non-success, not running). Callers must keep
// legacy_run_status in the activity result so operators can distinguish.
var WORKFLOW_ACTIVITY_STATUS_SUCCEEDED = 'succeeded'
var WORKFLOW_ACTIVITY_STATUS_FAILED = 'failed'
var WORKFLOW_ACTIVITY_STATUS_CANCELLED = 'cancelled'
var WORKFLOW_ACTIVITY_STATUS_RUNNING = 'running'

function statusIn(list, status) {
  return list.indexOf(status) !== -1
}

function isSuccessfulRunStatus(status) {
  return statusIn(SUCCESS_READ_STATUSES, status)
}

function isInterventionRunStatus(status) {
  return statusIn(INTERVENTION_READ_STATUSES, status)
}

function isFailedRunStatus(status) {
  return statusIn(FAILURE_READ_STATUSES, status)
}

function isCancelledRunStatus(status) {
  return statusIn(CANCELLED_READ_STATUSES, status)
}

function isActiveRunStatus(status) {
  return statusIn(ACTIVE_READ_STATUSES, status)
}

function isTerminalRunStatus(status) {
  return statusIn(TERMINAL_READ_STATUSES, status)
}

function isHistoricalSuccessAlias(status) {
  return status === HISTORICAL_SUCCESS_ALIAS
}

function isHistoricalFailureAlias(status) {
  return status === HISTORICAL_FAILURE_ALIAS
}

function classifyRunStatus(status) {
  if (isSuccessfulRunStatus(status)) return RUN_STATUS_KIND.SUCCESS
  if (isInterventionRunStatus(status)) return RUN_STATUS_KIND.INTERVENTION
  if (isFailedRunStatus(status)) return RUN_STATUS_KIND.FAILURE
  if (isCancelledRunStatus(status)) return RUN_STATUS_KIND.CANCELLED
  if (status === RUN_STATUS_QUEUED) return RUN_STATUS_KIND.QUEUED
  if (status === RUN_STATUS_RUNNING) return RUN_STATUS_KIND.RUNNING
  return RUN_STATUS_KIND.UNKNOWN
}

function getRunStatusPresentation(status) {
  var kind = classifyRunStatus(status)
  return {
    kind: kind,
    label: RUN_STATUS_LABELS[kind] || RUN_STATUS_LABELS.unknown,
  }
}

function mapRunStatusToWorkflowActivityStatus(status) {
  if (isSuccessfulRunStatus(status)) return WORKFLOW_ACTIVITY_STATUS_SUCCEEDED
  if (isInterventionRunStatus(status) || isFailedRunStatus(status)) {
    return WORKFLOW_ACTIVITY_STATUS_FAILED
  }
  if (isCancelledRunStatus(status)) return WORKFLOW_ACTIVITY_STATUS_CANCELLED
  return WORKFLOW_ACTIVITY_STATUS_RUNNING
}

function isTerminalWorkflowActivityStatus(status) {
  return (
    status === WORKFLOW_ACTIVITY_STATUS_SUCCEEDED ||
    status === WORKFLOW_ACTIVITY_STATUS_FAILED ||
    status === WORKFLOW_ACTIVITY_STATUS_CANCELLED
  )
}

module.exports = {
  RUN_STATUS_QUEUED: RUN_STATUS_QUEUED,
  RUN_STATUS_RUNNING: RUN_STATUS_RUNNING,
  RUN_STATUS_COMPLETE: RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW: RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR: RUN_STATUS_ERROR,
  RUN_STATUS_CANCELLED: RUN_STATUS_CANCELLED,
  CANONICAL_RUN_STATUSES: CANONICAL_RUN_STATUSES,
  CANONICAL_RUN_STATUS_SET: CANONICAL_RUN_STATUS_SET,
  HISTORICAL_SUCCESS_ALIAS: HISTORICAL_SUCCESS_ALIAS,
  HISTORICAL_FAILURE_ALIAS: HISTORICAL_FAILURE_ALIAS,
  SUCCESS_READ_STATUSES: SUCCESS_READ_STATUSES,
  INTERVENTION_READ_STATUSES: INTERVENTION_READ_STATUSES,
  FAILURE_READ_STATUSES: FAILURE_READ_STATUSES,
  CANCELLED_READ_STATUSES: CANCELLED_READ_STATUSES,
  ACTIVE_READ_STATUSES: ACTIVE_READ_STATUSES,
  TERMINAL_READ_STATUSES: TERMINAL_READ_STATUSES,
  RUN_STATUS_KIND: RUN_STATUS_KIND,
  RUN_STATUS_LABELS: RUN_STATUS_LABELS,
  isSuccessfulRunStatus: isSuccessfulRunStatus,
  isInterventionRunStatus: isInterventionRunStatus,
  isFailedRunStatus: isFailedRunStatus,
  isCancelledRunStatus: isCancelledRunStatus,
  isActiveRunStatus: isActiveRunStatus,
  isTerminalRunStatus: isTerminalRunStatus,
  isHistoricalSuccessAlias: isHistoricalSuccessAlias,
  isHistoricalFailureAlias: isHistoricalFailureAlias,
  classifyRunStatus: classifyRunStatus,
  getRunStatusPresentation: getRunStatusPresentation,
  mapRunStatusToWorkflowActivityStatus: mapRunStatusToWorkflowActivityStatus,
  isTerminalWorkflowActivityStatus: isTerminalWorkflowActivityStatus,
}
