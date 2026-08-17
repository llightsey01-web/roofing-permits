// tests/unit/worker-ahj-execution-gate.test.js
// ZIG-6: defensive gate semantics for worker/runner (non-retryable ahj_not_executable)
'use strict'

const {
  workerCanExecuteAhj,
  ahjNotExecutableError,
} = require('../../lib/ahj/ahj-readiness.js')

describe('worker AHJ execution gate (ZIG-6)', function () {
  test('defensive gate throws ahj_not_executable for inactive + populated runner', function () {
    var ahj = {
      name: 'Hillsborough County Building Department',
      is_active: false,
      lifecycle_state: 'validation_ready',
      operational_health: 'healthy',
      workflow_type: 'portal',
      workflow_file: 'hillsborough-county.runner.js',
    }
    expect(workerCanExecuteAhj(ahj)).toBe(false)
    var err = ahjNotExecutableError(ahj)
    expect(err.errorCode).toBe('ahj_not_executable')
    expect(err.nonRetryable).toBe(true)
    expect(String(err.message)).toMatch(/not executable/)
  })

  test('pre-claim fail-closed decision: do not claim when policy fails', function () {
    // Mirrors worker/index.js: if !workerCanExecuteAhj → terminal error, never claim/requeue.
    function shouldClaimQueuedRun(ahj) {
      return workerCanExecuteAhj(ahj) === true
    }
    expect(shouldClaimQueuedRun({
      is_active: false,
      lifecycle_state: 'production',
      operational_health: 'healthy',
      workflow_type: 'portal',
      workflow_file: 'polk-county.runner.js',
    })).toBe(false)
    expect(shouldClaimQueuedRun({
      is_active: true,
      lifecycle_state: 'production',
      operational_health: 'healthy',
      workflow_type: 'portal',
      workflow_file: 'polk-county.runner.js',
    })).toBe(true)
  })
})
