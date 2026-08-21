// tests/unit/workflow-bridge.test.js
// ZIG-13 PR 4: legacy run_status → workflow activity mapping
'use strict'

const { createWorkflowBridge } = require('../../lib/workflow/workflow-bridge.js')

function createMockState(legacy) {
  var activityUpdates = []
  return {
    activityUpdates: activityUpdates,
    updateRun: async function () { return null },
    supabase: {
      from: function (table) {
        var chain = {
          select: function () { return chain },
          insert: function () { return chain },
          update: function (payload) {
            if (table === 'workflow_activities') activityUpdates.push(payload)
            return chain
          },
          eq: function () { return chain },
          maybeSingle: async function () {
            return { data: legacy, error: null }
          },
          single: async function () {
            return { data: legacy, error: null }
          },
        }
        return chain
      },
    },
  }
}

describe('workflow bridge run-status readers (ZIG-13 PR 4)', function () {
  async function sync(status) {
    var state = createMockState({
      id: 'legacy-1',
      run_status: status,
      error_message: null,
      payload: { workflow_run_id: 'wf-1', workflow_activity_id: 'act-1' },
    })
    var bridge = createWorkflowBridge({ state: state })
    await bridge.syncLegacyRunCompletion({
      legacyRunId: 'legacy-1',
      workflowActivityId: 'act-1',
    })
    return state.activityUpdates[0]
  }

  test('complete maps to succeeded with completed_at', async function () {
    var update = await sync('complete')
    expect(update.status).toBe('succeeded')
    expect(update.completed_at).toBeTruthy()
  })

  test('needs_review is terminal intervention, not running', async function () {
    var update = await sync('needs_review')
    expect(update.status).not.toBe('running')
    expect(update.status).toBe('failed')
    expect(update.completed_at).toBeTruthy()
    expect(update.result.legacy_run_status).toBe('needs_review')
  })

  test('error maps to failed', async function () {
    var update = await sync('error')
    expect(update.status).toBe('failed')
    expect(update.completed_at).toBeTruthy()
  })

  test('cancelled maps to cancelled, not running', async function () {
    var update = await sync('cancelled')
    expect(update.status).toBe('cancelled')
    expect(update.completed_at).toBeTruthy()
  })

  test('queued and running stay active', async function () {
    var queued = await sync('queued')
    expect(queued.status).toBe('running')
    expect(queued.completed_at).toBe(null)
    var running = await sync('running')
    expect(running.status).toBe('running')
    expect(running.completed_at).toBe(null)
  })
})
