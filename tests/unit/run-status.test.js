// tests/unit/run-status.test.js
// ZIG-13 PR 1: canonical automation_runs.run_status writer contract
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
} = require('../../lib/automation/run-status.js')

var MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '../../lib/automation/run-status.js'),
  'utf8'
)

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
    var values = Object.keys(exported).reduce(function (acc, key) {
      var value = exported[key]
      if (typeof value === 'string') acc.push(value)
      return acc
    }, [])
    expect(values).not.toContain('completed')
    expect(values).not.toContain('submitted')
    expect(values).not.toContain('failed')
    expect(CANONICAL_RUN_STATUSES).not.toContain('completed')
    expect(CANONICAL_RUN_STATUSES).not.toContain('submitted')
    expect(CANONICAL_RUN_STATUSES).not.toContain('failed')
    expect(CANONICAL_RUN_STATUS_SET.completed).toBeUndefined()
    expect(CANONICAL_RUN_STATUS_SET.submitted).toBeUndefined()
    expect(CANONICAL_RUN_STATUS_SET.failed).toBeUndefined()
    expect(exported.RUN_STATUS_COMPLETED).toBeUndefined()
    expect(exported.RUN_STATUS_SUBMITTED).toBeUndefined()
    expect(exported.RUN_STATUS_FAILED).toBeUndefined()
    expect(MODULE_SRC).not.toMatch(/completed/)
    expect(MODULE_SRC).not.toMatch(/submitted/)
    expect(MODULE_SRC).not.toMatch(/failed/)
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
