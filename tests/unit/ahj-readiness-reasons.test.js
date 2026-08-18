// tests/unit/ahj-readiness-reasons.test.js
// PR A: reason helpers share the same evaluator as ZIG-6 eligibility booleans
'use strict'

const {
  contractorCanSeeAhj,
  workerCanExecuteAhj,
  getContractorVisibilityReasons,
  getWorkerExecutionReasons,
  _evaluateReadinessAxes,
} = require('../../lib/ahj/ahj-readiness.js')

function row(overrides) {
  return Object.assign(
    {
      id: 'x',
      name: 'Test AHJ',
      is_active: true,
      lifecycle_state: 'production',
      operational_health: 'healthy',
      workflow_type: 'portal',
      workflow_file: 'polk-county.runner.js',
    },
    overrides || {}
  )
}

var FIXTURES = [
  { label: 'fully ready', ahj: row() },
  { label: 'pilot', ahj: row({ lifecycle_state: 'pilot' }) },
  { label: 'degraded', ahj: row({ operational_health: 'degraded' }) },
  { label: 'inactive', ahj: row({ is_active: false }) },
  { label: 'unavailable', ahj: row({ operational_health: 'unavailable' }) },
  { label: 'planned lifecycle', ahj: row({ lifecycle_state: 'planned' }) },
  { label: 'dry_run lifecycle', ahj: row({ lifecycle_state: 'dry_run' }) },
  { label: 'missing workflow_file', ahj: row({ workflow_file: null }) },
  { label: 'pdf_packet no file', ahj: row({ workflow_type: 'pdf_packet', workflow_file: null }) },
  { label: 'hybrid', ahj: row({ workflow_type: 'hybrid', workflow_file: null }) },
  { label: 'email', ahj: row({ workflow_type: 'email', workflow_file: null }) },
  { label: 'unknown health', ahj: row({ operational_health: 'weird' }) },
  { label: 'missing lifecycle', ahj: (function () { var r = row(); delete r.lifecycle_state; return r })() },
  { label: 'missing health', ahj: (function () { var r = row(); delete r.operational_health; return r })() },
  { label: 'missing workflow_type', ahj: (function () { var r = row(); delete r.workflow_type; return r })() },
  { label: 'null row', ahj: null },
]

describe('ahj-readiness reasons (PR A)', function () {
  test('boolean parity with reason helpers across fixtures', function () {
    FIXTURES.forEach(function (fx) {
      expect(contractorCanSeeAhj(fx.ahj)).toBe(getContractorVisibilityReasons(fx.ahj).visible)
      expect(workerCanExecuteAhj(fx.ahj)).toBe(getWorkerExecutionReasons(fx.ahj).executable)
    })
  })

  test('visibility and execution share the same evaluator eligible flag', function () {
    FIXTURES.forEach(function (fx) {
      var ev = _evaluateReadinessAxes(fx.ahj)
      expect(getContractorVisibilityReasons(fx.ahj).visible).toBe(ev.eligible)
      expect(getWorkerExecutionReasons(fx.ahj).executable).toBe(ev.eligible)
      expect(getContractorVisibilityReasons(fx.ahj).blocking_reason).toBe(ev.blocking_reason)
      expect(getWorkerExecutionReasons(fx.ahj).blocking_reason).toBe(ev.blocking_reason)
    })
  })

  test('every readiness axis can block with a blocking_reason', function () {
    expect(getContractorVisibilityReasons(row({ is_active: false })).blocking_reason).toBe('inactive')
    expect(
      getContractorVisibilityReasons(row({ lifecycle_state: 'planned' })).blocking_reason
    ).toBe('lifecycle_not_executable')
    expect(
      getContractorVisibilityReasons(row({ operational_health: 'unavailable' })).blocking_reason
    ).toBe('unavailable')
    expect(
      getContractorVisibilityReasons(row({ operational_health: 'weird' })).blocking_reason
    ).toBe('health_unrecognized')
    expect(
      getContractorVisibilityReasons(
        (function () {
          var r = row()
          delete r.workflow_type
          return r
        })()
      ).blocking_reason
    ).toBe('workflow_unrecognized')
    expect(
      getContractorVisibilityReasons(row({ workflow_file: null })).blocking_reason
    ).toBe('missing_workflow_file')
  })

  test('blocking reason precedence follows evaluator order (inactive first)', function () {
    var blocked = row({
      is_active: false,
      lifecycle_state: 'planned',
      operational_health: 'unavailable',
      workflow_file: null,
    })
    expect(getWorkerExecutionReasons(blocked).blocking_reason).toBe('inactive')
    expect(getWorkerExecutionReasons(blocked).executable).toBe(false)
  })

  test('ready AHJ has null blocking_reason and pass reason text', function () {
    var result = getContractorVisibilityReasons(row())
    expect(result.visible).toBe(true)
    expect(result.blocking_reason).toBeNull()
    expect(result.reasons.some(function (r) {
      return /pass/i.test(r)
    })).toBe(true)
  })

  test('reasons array is populated for failures', function () {
    var result = getWorkerExecutionReasons(row({ is_active: false }))
    expect(result.executable).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0]).toMatch(/inactive/i)
  })
})
