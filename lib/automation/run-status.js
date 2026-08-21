// lib/automation/run-status.js
// Canonical automation_runs.run_status writer contract.
// Values only. Does not interpret success, dashboards, recovery, or schema.

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

module.exports = {
  RUN_STATUS_QUEUED: RUN_STATUS_QUEUED,
  RUN_STATUS_RUNNING: RUN_STATUS_RUNNING,
  RUN_STATUS_COMPLETE: RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW: RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR: RUN_STATUS_ERROR,
  RUN_STATUS_CANCELLED: RUN_STATUS_CANCELLED,
  CANONICAL_RUN_STATUSES: CANONICAL_RUN_STATUSES,
  CANONICAL_RUN_STATUS_SET: CANONICAL_RUN_STATUS_SET,
}
