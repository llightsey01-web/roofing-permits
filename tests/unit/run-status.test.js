// tests/unit/run-status.test.js
// ZIG-13: canonical automation_runs.run_status writer + reader contracts
'use strict'

const fs = require('fs')
const path = require('path')
const {
  RUN_STATUS_QUEUED,
  RUN_STATUS_RUNNING,
  RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR,
  RUN_STATUS_CANCELLED,
  CANONICAL_RUN_STATUSES,
  CANONICAL_RUN_STATUS_SET,
  HISTORICAL_SUCCESS_ALIAS,
  HISTORICAL_FAILURE_ALIAS,
  SUCCESS_READ_STATUSES,
  INTERVENTION_READ_STATUSES,
  FAILURE_READ_STATUSES,
  TERMINAL_READ_STATUSES,
  RUN_STATUS_KIND,
  RUN_OUTCOME,
  isSuccessfulRunStatus,
  isInterventionRunStatus,
  isFailedRunStatus,
  isCancelledRunStatus,
  isActiveRunStatus,
  isTerminalRunStatus,
  isHistoricalSuccessAlias,
  isHistoricalFailureAlias,
  classifyRunStatus,
  classifyRunOutcome,
  getRunStatusPresentation,
  mapRunStatusToWorkflowActivityStatus,
  isTerminalWorkflowActivityStatus,
} = require('../../lib/automation/run-status.js')

var MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '../../lib/automation/run-status.js'),
  'utf8'
)

var WRITER_SECTION = MODULE_SRC.split('Reader-only compatibility')[0]

describe('canonical automation_runs.run_status contract (ZIG-13 PR 1)', function () {
  test('named constants match the six canonical writer values', function () {
    expect(RUN_STATUS_QUEUED).toBe('queued')
    expect(RUN_STATUS_RUNNING).toBe('running')
    expect(RUN_STATUS_COMPLETE).toBe('complete')
    expect(RUN_STATUS_NEEDS_REVIEW).toBe('needs_review')
    expect(RUN_STATUS_ERROR).toBe('error')
    expect(RUN_STATUS_CANCELLED).toBe('cancelled')
  })

  test('frozen collection is exactly the six canonical values in contract order', function () {
    expect(Array.from(CANONICAL_RUN_STATUSES)).toEqual([
      'queued',
      'running',
      'complete',
      'needs_review',
      'error',
      'cancelled',
    ])
  })

  test('frozen set includes only the six canonical writer values', function () {
    expect(Object.keys(CANONICAL_RUN_STATUS_SET).sort()).toEqual([
      'cancelled',
      'complete',
      'error',
      'needs_review',
      'queued',
      'running',
    ])
    expect(CANONICAL_RUN_STATUS_SET.queued).toBe(true)
    expect(CANONICAL_RUN_STATUS_SET.running).toBe(true)
    expect(CANONICAL_RUN_STATUS_SET.complete).toBe(true)
    expect(CANONICAL_RUN_STATUS_SET.needs_review).toBe(true)
    expect(CANONICAL_RUN_STATUS_SET.error).toBe(true)
    expect(CANONICAL_RUN_STATUS_SET.cancelled).toBe(true)
  })

  test('completed, submitted, and failed are absent from the writer contract', function () {
    var exported = require('../../lib/automation/run-status.js')
    expect(exported.RUN_STATUS_COMPLETED).toBeUndefined()
    expect(exported.RUN_STATUS_SUBMITTED).toBeUndefined()
    expect(exported.RUN_STATUS_FAILED).toBeUndefined()
    expect(CANONICAL_RUN_STATUSES).not.toContain('completed')
    expect(CANONICAL_RUN_STATUSES).not.toContain('submitted')
    expect(CANONICAL_RUN_STATUSES).not.toContain('failed')
    expect(CANONICAL_RUN_STATUS_SET.completed).toBeUndefined()
    expect(CANONICAL_RUN_STATUS_SET.submitted).toBeUndefined()
    expect(CANONICAL_RUN_STATUS_SET.failed).toBeUndefined()
    expect(WRITER_SECTION).not.toMatch(/completed/)
    expect(WRITER_SECTION).not.toMatch(/submitted/)
    expect(WRITER_SECTION).not.toMatch(/failed/)
  })

  test('canonical collection and set are frozen', function () {
    expect(Object.isFrozen(CANONICAL_RUN_STATUSES)).toBe(true)
    expect(Object.isFrozen(CANONICAL_RUN_STATUS_SET)).toBe(true)
    expect(function () {
      CANONICAL_RUN_STATUSES.push('completed')
    }).toThrow()
    expect(function () {
      CANONICAL_RUN_STATUS_SET.completed = true
    }).toThrow()
    expect(function () {
      CANONICAL_RUN_STATUS_SET.queued = false
    }).toThrow()
    expect(CANONICAL_RUN_STATUSES).not.toContain('completed')
    expect(CANONICAL_RUN_STATUS_SET.completed).toBeUndefined()
    expect(CANONICAL_RUN_STATUS_SET.queued).toBe(true)
  })
})

describe('automation_runs.run_status reader contract (ZIG-13 PR 4)', function () {
  test('complete is canonical success', function () {
    expect(isSuccessfulRunStatus('complete')).toBe(true)
    expect(classifyRunStatus('complete')).toBe(RUN_STATUS_KIND.SUCCESS)
    expect(getRunStatusPresentation('complete').label).toBe('Success')
    expect(isTerminalRunStatus('complete')).toBe(true)
    expect(isInterventionRunStatus('complete')).toBe(false)
    expect(isFailedRunStatus('complete')).toBe(false)
  })

  test('completed is historical success compatibility only', function () {
    expect(HISTORICAL_SUCCESS_ALIAS).toBe('completed')
    expect(isHistoricalSuccessAlias('completed')).toBe(true)
    expect(isSuccessfulRunStatus('completed')).toBe(true)
    expect(SUCCESS_READ_STATUSES).toContain('completed')
    expect(CANONICAL_RUN_STATUSES).not.toContain('completed')
    expect(classifyRunStatus('completed')).toBe(RUN_STATUS_KIND.SUCCESS)
    expect(getRunStatusPresentation('completed').label).toBe('Success')
    expect(isTerminalRunStatus('completed')).toBe(true)
  })

  test('needs_review is terminal intervention, not success or failure', function () {
    expect(isSuccessfulRunStatus('needs_review')).toBe(false)
    expect(isFailedRunStatus('needs_review')).toBe(false)
    expect(isInterventionRunStatus('needs_review')).toBe(true)
    expect(isTerminalRunStatus('needs_review')).toBe(true)
    expect(isActiveRunStatus('needs_review')).toBe(false)
    expect(classifyRunStatus('needs_review')).toBe(RUN_STATUS_KIND.INTERVENTION)
    expect(getRunStatusPresentation('needs_review').label).toBe('Needs review')
    expect(INTERVENTION_READ_STATUSES).toEqual(['needs_review'])
  })

  test('error is failure', function () {
    expect(isFailedRunStatus('error')).toBe(true)
    expect(isSuccessfulRunStatus('error')).toBe(false)
    expect(isInterventionRunStatus('error')).toBe(false)
    expect(isTerminalRunStatus('error')).toBe(true)
    expect(classifyRunStatus('error')).toBe(RUN_STATUS_KIND.FAILURE)
    expect(getRunStatusPresentation('error').label).toBe('Failed')
  })

  test('cancelled is terminal non-success', function () {
    expect(isCancelledRunStatus('cancelled')).toBe(true)
    expect(isSuccessfulRunStatus('cancelled')).toBe(false)
    expect(isFailedRunStatus('cancelled')).toBe(false)
    expect(isInterventionRunStatus('cancelled')).toBe(false)
    expect(isTerminalRunStatus('cancelled')).toBe(true)
    expect(isActiveRunStatus('cancelled')).toBe(false)
    expect(classifyRunStatus('cancelled')).toBe(RUN_STATUS_KIND.CANCELLED)
    expect(getRunStatusPresentation('cancelled').label).toBe('Cancelled')
  })

  test('queued and running are non-terminal', function () {
    expect(isActiveRunStatus('queued')).toBe(true)
    expect(isActiveRunStatus('running')).toBe(true)
    expect(isTerminalRunStatus('queued')).toBe(false)
    expect(isTerminalRunStatus('running')).toBe(false)
    expect(isSuccessfulRunStatus('queued')).toBe(false)
    expect(isSuccessfulRunStatus('running')).toBe(false)
    expect(classifyRunStatus('queued')).toBe(RUN_STATUS_KIND.QUEUED)
    expect(classifyRunStatus('running')).toBe(RUN_STATUS_KIND.RUNNING)
    expect(getRunStatusPresentation('queued').label).toBe('Queued')
    expect(getRunStatusPresentation('running').label).toBe('Running')
  })

  test('submitted is never automation-run success', function () {
    expect(isSuccessfulRunStatus('submitted')).toBe(false)
    expect(isTerminalRunStatus('submitted')).toBe(false)
    expect(classifyRunStatus('submitted')).toBe(RUN_STATUS_KIND.UNKNOWN)
    expect(SUCCESS_READ_STATUSES).not.toContain('submitted')
    expect(TERMINAL_READ_STATUSES).not.toContain('submitted')
    expect(CANONICAL_RUN_STATUSES).not.toContain('submitted')
  })

  test('failed is historical failure compatibility only', function () {
    expect(HISTORICAL_FAILURE_ALIAS).toBe('failed')
    expect(isHistoricalFailureAlias('failed')).toBe(true)
    expect(isFailedRunStatus('failed')).toBe(true)
    expect(isSuccessfulRunStatus('failed')).toBe(false)
    expect(FAILURE_READ_STATUSES).toContain('failed')
    expect(CANONICAL_RUN_STATUSES).not.toContain('failed')
    expect(isTerminalRunStatus('failed')).toBe(true)
    expect(classifyRunStatus('failed')).toBe(RUN_STATUS_KIND.FAILURE)
    expect(getRunStatusPresentation('failed').label).toBe('Failed')
  })

  test('reader aliases are frozen and not writer constants', function () {
    expect(Object.isFrozen(SUCCESS_READ_STATUSES)).toBe(true)
    expect(Object.isFrozen(FAILURE_READ_STATUSES)).toBe(true)
    expect(Object.isFrozen(TERMINAL_READ_STATUSES)).toBe(true)
    expect(function () {
      SUCCESS_READ_STATUSES.push('submitted')
    }).toThrow()
    expect(SUCCESS_READ_STATUSES).not.toContain('submitted')
    expect(SUCCESS_READ_STATUSES).not.toContain('needs_review')
  })

  test('workflow activity mapping keeps needs_review terminal and not running', function () {
    expect(mapRunStatusToWorkflowActivityStatus('complete')).toBe('succeeded')
    expect(mapRunStatusToWorkflowActivityStatus('completed')).toBe('succeeded')
    expect(mapRunStatusToWorkflowActivityStatus('error')).toBe('failed')
    expect(mapRunStatusToWorkflowActivityStatus('failed')).toBe('failed')
    expect(mapRunStatusToWorkflowActivityStatus('needs_review')).toBe('failed')
    expect(mapRunStatusToWorkflowActivityStatus('needs_review')).not.toBe('running')
    expect(mapRunStatusToWorkflowActivityStatus('cancelled')).toBe('cancelled')
    expect(mapRunStatusToWorkflowActivityStatus('queued')).toBe('running')
    expect(mapRunStatusToWorkflowActivityStatus('running')).toBe('running')
    expect(isTerminalWorkflowActivityStatus('succeeded')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('failed')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('cancelled')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('running')).toBe(false)
  })

  test('classifyRunOutcome maps persisted statuses to the canonical outcome contract', function () {
    expect(classifyRunOutcome('complete')).toBe(RUN_OUTCOME.SUCCESS)
    expect(classifyRunOutcome('completed')).toBe(RUN_OUTCOME.SUCCESS)
    expect(classifyRunOutcome('needs_review')).toBe(RUN_OUTCOME.INTERVENTION)
    expect(classifyRunOutcome('error')).toBe(RUN_OUTCOME.FAILURE)
    expect(classifyRunOutcome('failed')).toBe(RUN_OUTCOME.FAILURE)
    expect(classifyRunOutcome('queued')).toBe(RUN_OUTCOME.ACTIVE)
    expect(classifyRunOutcome('running')).toBe(RUN_OUTCOME.ACTIVE)
    expect(classifyRunOutcome('cancelled')).toBe(RUN_OUTCOME.CANCELLED)
  })

  test('classifyRunOutcome fails closed on unknown statuses', function () {
    expect(classifyRunOutcome('submitted')).toBe(RUN_OUTCOME.UNKNOWN)
    expect(classifyRunOutcome('bogus')).toBe(RUN_OUTCOME.UNKNOWN)
    expect(classifyRunOutcome(null)).toBe(RUN_OUTCOME.UNKNOWN)
    expect(classifyRunOutcome(undefined)).toBe(RUN_OUTCOME.UNKNOWN)
    expect(classifyRunOutcome('')).toBe(RUN_OUTCOME.UNKNOWN)
  })
})
