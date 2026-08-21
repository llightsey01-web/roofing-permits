// tests/unit/platform-metrics.test.js
// ZIG-13 PR 4: platform metrics reader semantics
'use strict'

const {
  isSuccessStatus,
  summarizeRunOutcomes,
  SUCCESS_STATUSES,
} = require('../../lib/monitoring/platform-metrics.js')

describe('platform metrics run-status readers (ZIG-13 PR 4)', function () {
  test('success statuses are complete plus historical completed only', function () {
    expect(Array.from(SUCCESS_STATUSES)).toEqual(['complete', 'completed'])
    expect(isSuccessStatus('complete')).toBe(true)
    expect(isSuccessStatus('completed')).toBe(true)
    expect(isSuccessStatus('needs_review')).toBe(false)
    expect(isSuccessStatus('error')).toBe(false)
    expect(isSuccessStatus('cancelled')).toBe(false)
    expect(isSuccessStatus('queued')).toBe(false)
    expect(isSuccessStatus('running')).toBe(false)
    expect(isSuccessStatus('submitted')).toBe(false)
    expect(isSuccessStatus('failed')).toBe(false)
  })

  test('summarizeRunOutcomes does not count needs_review as success', function () {
    var summary = summarizeRunOutcomes([
      { run_status: 'complete' },
      { run_status: 'completed' },
      { run_status: 'needs_review' },
      { run_status: 'error' },
      { run_status: 'failed' },
      { run_status: 'cancelled' },
      { run_status: 'queued' },
      { run_status: 'running' },
      { run_status: 'submitted' },
    ])
    expect(summary.success).toBe(2)
    expect(summary.intervention).toBe(1)
    expect(summary.failure).toBe(2)
    expect(summary.cancelled).toBe(1)
    expect(summary.total).toBe(6)
  })

  test('needs_review is terminal non-success and is not collapsed into failure', function () {
    var summary = summarizeRunOutcomes([
      { run_status: 'needs_review' },
      { run_status: 'needs_review' },
    ])
    expect(summary.success).toBe(0)
    expect(summary.failure).toBe(0)
    expect(summary.intervention).toBe(2)
    expect(summary.total).toBe(2)
  })
})
