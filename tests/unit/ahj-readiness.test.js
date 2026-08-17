// tests/unit/ahj-readiness.test.js
// ZIG-6: contractor + worker readiness policies
'use strict'

const {
  contractorCanSeeAhj,
  workerCanExecuteAhj,
  ahjNotExecutableError,
} = require('../../lib/ahj/ahj-readiness.js')
const { withRetry } = require('../../lib/automation/retry.js')

function row(overrides) {
  return Object.assign({
    id: 'x',
    name: 'Test AHJ',
    is_active: true,
    lifecycle_state: 'production',
    operational_health: 'healthy',
    workflow_type: 'portal',
    workflow_file: 'polk-county.runner.js',
  }, overrides || {})
}

describe('ahj-readiness (ZIG-6)', function () {
  test('Polk/Lee shape: active + pilot|production + healthy + runner → visible and executable', function () {
    var polk = row({ name: 'Polk', lifecycle_state: 'production' })
    var lee = row({ name: 'Lee', lifecycle_state: 'pilot' })
    expect(contractorCanSeeAhj(polk)).toBe(true)
    expect(workerCanExecuteAhj(polk)).toBe(true)
    expect(contractorCanSeeAhj(lee)).toBe(true)
    expect(workerCanExecuteAhj(lee)).toBe(true)
  })

  test('lifecycle matrix: only pilot and production pass', function () {
    ;['planned', 'development', 'validation_ready', 'dry_run'].forEach(function (state) {
      expect(contractorCanSeeAhj(row({ lifecycle_state: state }))).toBe(false)
      expect(workerCanExecuteAhj(row({ lifecycle_state: state }))).toBe(false)
    })
    expect(contractorCanSeeAhj(row({ lifecycle_state: 'pilot' }))).toBe(true)
    expect(contractorCanSeeAhj(row({ lifecycle_state: 'production' }))).toBe(true)
  })

  test('operational_health: healthy and degraded allowed; unavailable rejected', function () {
    expect(contractorCanSeeAhj(row({ operational_health: 'healthy' }))).toBe(true)
    expect(workerCanExecuteAhj(row({ operational_health: 'healthy' }))).toBe(true)
    expect(contractorCanSeeAhj(row({ operational_health: 'degraded' }))).toBe(true)
    expect(workerCanExecuteAhj(row({ operational_health: 'degraded' }))).toBe(true)
    expect(contractorCanSeeAhj(row({ operational_health: 'unavailable' }))).toBe(false)
    expect(workerCanExecuteAhj(row({ operational_health: 'unavailable' }))).toBe(false)
  })

  test('is_active false blocks even with runner + production', function () {
    var blocked = row({
      is_active: false,
      lifecycle_state: 'production',
      workflow_file: 'hillsborough-county.runner.js',
    })
    expect(contractorCanSeeAhj(blocked)).toBe(false)
    expect(workerCanExecuteAhj(blocked)).toBe(false)
  })

  test('portal workflow requires non-null workflow_file', function () {
    expect(contractorCanSeeAhj(row({ workflow_type: 'portal', workflow_file: null }))).toBe(false)
    expect(workerCanExecuteAhj(row({ workflow_type: 'portal', workflow_file: null }))).toBe(false)
  })

  test('non-portal recognized workflow_type may omit workflow_file', function () {
    ;['pdf_packet', 'hybrid', 'email'].forEach(function (wt) {
      var packet = row({ workflow_type: wt, workflow_file: null })
      expect(contractorCanSeeAhj(packet)).toBe(true)
      expect(workerCanExecuteAhj(packet)).toBe(true)
    })
  })

  test('fail closed: missing lifecycle_state', function () {
    var r = row({})
    delete r.lifecycle_state
    expect(contractorCanSeeAhj(r)).toBe(false)
    expect(workerCanExecuteAhj(r)).toBe(false)
    expect(contractorCanSeeAhj(row({ lifecycle_state: null }))).toBe(false)
    expect(contractorCanSeeAhj(row({ lifecycle_state: undefined }))).toBe(false)
  })

  test('fail closed: missing operational_health', function () {
    var r = row({})
    delete r.operational_health
    expect(contractorCanSeeAhj(r)).toBe(false)
    expect(workerCanExecuteAhj(r)).toBe(false)
    expect(contractorCanSeeAhj(row({ operational_health: null }))).toBe(false)
  })

  test('fail closed: unknown operational_health', function () {
    expect(contractorCanSeeAhj(row({ operational_health: 'weird' }))).toBe(false)
    expect(workerCanExecuteAhj(row({ operational_health: 'weird' }))).toBe(false)
    expect(contractorCanSeeAhj(row({ operational_health: '' }))).toBe(false)
  })

  test('fail closed: missing workflow_type', function () {
    var r = row({})
    delete r.workflow_type
    expect(contractorCanSeeAhj(r)).toBe(false)
    expect(workerCanExecuteAhj(r)).toBe(false)
    expect(contractorCanSeeAhj(row({ workflow_type: null }))).toBe(false)
  })

  test('fail closed: unknown workflow_type', function () {
    expect(contractorCanSeeAhj(row({ workflow_type: 'api' }))).toBe(false)
    expect(workerCanExecuteAhj(row({ workflow_type: 'accela' }))).toBe(false)
    expect(contractorCanSeeAhj(row({ workflow_type: '' }))).toBe(false)
  })

  test('fail closed: portal with missing workflow_file', function () {
    expect(contractorCanSeeAhj(row({ workflow_type: 'portal', workflow_file: null }))).toBe(false)
    expect(workerCanExecuteAhj(row({ workflow_type: 'portal', workflow_file: undefined }))).toBe(false)
    var r = row({ workflow_type: 'portal' })
    delete r.workflow_file
    expect(contractorCanSeeAhj(r)).toBe(false)
  })

  test('policies stay separate exports but match for current portal matrix', function () {
    expect(contractorCanSeeAhj).not.toBe(workerCanExecuteAhj)
    var samples = [
      row({}),
      row({ is_active: false }),
      row({ lifecycle_state: 'validation_ready' }),
      row({ operational_health: 'unavailable' }),
      row({ workflow_file: null }),
      row({ operational_health: null }),
      row({ workflow_type: 'unknown' }),
    ]
    samples.forEach(function (r) {
      expect(contractorCanSeeAhj(r)).toBe(workerCanExecuteAhj(r))
    })
  })

  test('inactive + populated runner is rejected by worker policy (pre-ZIG-6 bypass shape)', function () {
    var exposed = row({
      name: 'Hillsborough County Building Department',
      is_active: false,
      lifecycle_state: 'validation_ready',
      workflow_file: 'hillsborough-county.runner.js',
    })
    expect(workerCanExecuteAhj(exposed)).toBe(false)
    var err = ahjNotExecutableError(exposed)
    expect(err.errorCode).toBe('ahj_not_executable')
    expect(err.nonRetryable).toBe(true)
  })

  test('withRetry does not retry ahj_not_executable', async function () {
    var calls = 0
    await expect(
      withRetry(function () {
        calls += 1
        throw ahjNotExecutableError(row({ is_active: false }))
      }, { maxAttempts: 3, delayMs: 1, label: 'zig6_gate' })
    ).rejects.toMatchObject({ errorCode: 'ahj_not_executable' })
    expect(calls).toBe(1)
  })
})
