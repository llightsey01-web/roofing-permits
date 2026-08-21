// tests/unit/wait-for-activity.test.js
// ZIG-13 PR 4: wait-for-activity still treats needs_review as terminal
'use strict'

const fs = require('fs')
const path = require('path')
const {
  isTerminalRunStatus,
  isTerminalWorkflowActivityStatus,
} = require('../../lib/automation/run-status.js')

var WAIT_SRC = fs.readFileSync(
  path.join(__dirname, '../../trigger/tasks/activities/wait-for-activity.js'),
  'utf8'
)

describe('wait-for-activity terminal readers (ZIG-13 PR 4)', function () {
  test('wait helper uses shared terminal classifiers', function () {
    expect(WAIT_SRC).toMatch(/isTerminalRunStatus/)
    expect(WAIT_SRC).toMatch(/isTerminalWorkflowActivityStatus/)
    expect(WAIT_SRC).not.toMatch(/legacy\.run_status === 'complete' \|\| legacy\.run_status === 'error' \|\| legacy\.run_status === 'needs_review'/)
  })

  test('needs_review remains terminal even though it is not success', function () {
    expect(isTerminalRunStatus('needs_review')).toBe(true)
    expect(isTerminalRunStatus('complete')).toBe(true)
    expect(isTerminalRunStatus('completed')).toBe(true)
    expect(isTerminalRunStatus('error')).toBe(true)
    expect(isTerminalRunStatus('cancelled')).toBe(true)
    expect(isTerminalRunStatus('queued')).toBe(false)
    expect(isTerminalRunStatus('running')).toBe(false)
  })

  test('workflow activity wait also stops on cancelled', function () {
    expect(isTerminalWorkflowActivityStatus('succeeded')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('failed')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('cancelled')).toBe(true)
    expect(isTerminalWorkflowActivityStatus('running')).toBe(false)
  })
})
