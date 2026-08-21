// tests/unit/epn-submit-outcome.test.js
// ZIG-18: persisted automation_runs.run_status is the ePN submit outcome authority
'use strict'

const fs = require('fs')
const path = require('path')
const { onLegacyErecordActivityComplete, EVENT_NAMES } = require('../../lib/workflow/epn-migration.js')
const { handleErecordSubmit } = require('../../worker/handlers/epn-handler.js')
const { RUN_STATUS } = require('../../lib/workflow/constants.js')

function createEngine(persisted, workflowRun) {
  var emitted = []
  var runUpdates = []
  var resumeCalls = []
  var workflow = workflowRun || {
    id: 'wf-1',
    job_id: 'job-1',
    company_id: 'co-1',
    status: 'waiting',
    current_step_key: 'submit_epn',
  }
  var engine = {
    emitted: emitted,
    runUpdates: runUpdates,
    resumeCalls: resumeCalls,
    events: {
      emitEvent: async function (input) {
        emitted.push(input)
      },
    },
    state: {
      getRun: async function () {
        return workflow
      },
      updateRun: async function (id, patch) {
        runUpdates.push({ id: id, patch: patch })
        Object.assign(workflow, patch)
        return workflow
      },
    },
    bridge: {
      syncLegacyRunCompletion: async function () {
        return {
          legacy: persisted,
          workflowRunId: persisted.payload && persisted.payload.workflow_run_id,
          activityId: persisted.payload && persisted.payload.workflow_activity_id,
        }
      },
    },
  }
  return engine
}

function submitRun(overrides) {
  return Object.assign(
    {
      id: 'run-1',
      run_type: 'erecord_submit',
      run_status: 'needs_review',
      error_message: null,
      payload: {
        workflow_run_id: 'wf-1',
        workflow_activity_id: 'act-1',
      },
    },
    overrides || {}
  )
}

async function completeSubmit(persisted, caller) {
  var engine = createEngine(persisted)
  var resumeEpnWorkflow = jest.fn(async function (runId, options) {
    engine.resumeCalls.push({ runId: runId, options: options })
    return { status: 'waiting' }
  })
  var result = await onLegacyErecordActivityComplete(
    Object.assign(
      {
        legacyRun: Object.assign({}, persisted, (caller && caller.legacyRunPatch) || {}),
        engine: engine,
        resumeEpnWorkflow: resumeEpnWorkflow,
      },
      caller || {}
    )
  )
  return {
    result: result,
    engine: engine,
    resumeEpnWorkflow: resumeEpnWorkflow,
  }
}

describe('ZIG-18 ePN submit outcome contract', function () {
  test('A. persisted complete emits success events and resumes with completeCurrentStep true', async function () {
    var persisted = submitRun({ run_status: 'complete' })
    var got = await completeSubmit(persisted)

    expect(got.result.ok).toBe(true)
    expect(got.result.outcome).toBe('success')
    expect(got.engine.emitted.map(function (e) { return e.eventName })).toEqual([
      EVENT_NAMES.ERECORD_SUBMITTED,
      EVENT_NAMES.ACTIVITY_COMPLETED,
    ])
    expect(got.engine.emitted.filter(function (e) {
      return e.eventName === EVENT_NAMES.ERECORD_SUBMITTED
    })).toHaveLength(1)
    expect(got.resumeEpnWorkflow).toHaveBeenCalledTimes(1)
    expect(got.resumeEpnWorkflow.mock.calls[0][1].completeCurrentStep).toBe(true)
    expect(got.engine.runUpdates).toEqual([])
  })

  test('B. needs_review ignores caller success/complete and does not resume or fail', async function () {
    var persisted = submitRun({ run_status: 'needs_review' })
    var got = await completeSubmit(persisted, {
      success: true,
      legacyRunPatch: { run_status: 'complete' },
    })

    expect(got.result.ok).toBe(true)
    expect(got.result.outcome).toBe('intervention')
    expect(got.result.activityResult).toEqual({
      legacy_run_status: 'needs_review',
      outcome: 'intervention',
      error_message: null,
    })
    expect(got.engine.emitted).toEqual([])
    expect(got.resumeEpnWorkflow).not.toHaveBeenCalled()
    expect(got.engine.runUpdates).toEqual([])
  })

  test('C. persisted error fails the workflow without resume or ErecordSubmitted', async function () {
    var persisted = submitRun({
      run_status: 'error',
      error_message: 'portal rejected',
    })
    var got = await completeSubmit(persisted, { success: true })

    expect(got.result.ok).toBe(false)
    expect(got.result.outcome).toBe('failure')
    expect(got.engine.emitted.map(function (e) { return e.eventName })).toEqual([
      EVENT_NAMES.ACTIVITY_FAILED,
    ])
    expect(got.resumeEpnWorkflow).not.toHaveBeenCalled()
    expect(got.engine.runUpdates).toEqual([
      {
        id: 'wf-1',
        patch: {
          status: RUN_STATUS.FAILED,
          error_message: 'portal rejected',
        },
      },
    ])
  })

  test('D. caller-provided success cannot override persisted needs_review', async function () {
    var persisted = submitRun({ run_status: 'needs_review' })
    var got = await completeSubmit(persisted, {
      success: true,
      result: { run_status: 'complete' },
    })
    expect(got.result.outcome).toBe('intervention')
    expect(got.engine.emitted.some(function (e) {
      return e.eventName === EVENT_NAMES.ERECORD_SUBMITTED
    })).toBe(false)
    expect(got.resumeEpnWorkflow).not.toHaveBeenCalled()
  })

  test('E. unknown persisted status fails closed without advancing', async function () {
    var persisted = submitRun({ run_status: 'submitted' })
    var engine = createEngine(persisted)
    var resumeEpnWorkflow = jest.fn()

    await expect(
      onLegacyErecordActivityComplete({
        legacyRun: persisted,
        engine: engine,
        resumeEpnWorkflow: resumeEpnWorkflow,
        success: true,
      })
    ).rejects.toThrow(/cannot advance from run_status=submitted/)

    expect(engine.emitted).toEqual([])
    expect(resumeEpnWorkflow).not.toHaveBeenCalled()
    expect(engine.runUpdates).toEqual([])
  })

  test('F. intervention path never invokes completeCurrentStep false', async function () {
    var persisted = submitRun({ run_status: 'needs_review' })
    var got = await completeSubmit(persisted, { success: true })
    expect(got.resumeEpnWorkflow).not.toHaveBeenCalled()
    expect(got.engine.resumeCalls.some(function (call) {
      return call.options && call.options.completeCurrentStep === false
    })).toBe(false)
  })

  test('onLegacyErecordActivityComplete no longer branches on caller success', function () {
    var src = fs.readFileSync(
      path.join(__dirname, '../../lib/workflow/epn-migration.js'),
      'utf8'
    )
    expect(src).not.toMatch(/i\.success/)
    expect(src).not.toMatch(/success !== false/)
    expect(src).toMatch(/classifyRunOutcome/)
    expect(src).toMatch(/completeCurrentStep: true/)
    expect(src).not.toMatch(/completeCurrentStep:\s*false/)
  })
})

describe('ZIG-18 erecord_submit handler honesty', function () {
  test('stub persists needs_review and does not fabricate complete/success', async function () {
    var markCalls = []
    var completeCalls = []
    var actionCalls = []
    var run = submitRun({ run_status: 'queued' })

    var result = await handleErecordSubmit(
      { id: 'job-1', company_id: 'co-1' },
      run,
      {
        markRunComplete: async function (id, extra) {
          markCalls.push({ id: id, extra: extra })
        },
        logRunAction: async function (entry) {
          actionCalls.push(entry)
        },
        onLegacyErecordActivityComplete: async function (input) {
          completeCalls.push(input)
        },
      }
    )

    expect(markCalls).toEqual([
      { id: 'run-1', extra: { run_status: 'needs_review' } },
    ])
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0].success).toBeUndefined()
    expect(completeCalls[0].legacyRun.run_status).not.toBe('complete')
    expect(completeCalls[0].legacyRun).toBe(run)
    expect(completeCalls[0].result.outcome).toBe('intervention')
    expect(completeCalls[0].result.legal_submission).toBe(false)
    expect(result.outcome).toBe('intervention')
    expect(result.legal_submission).toBe(false)
    expect(actionCalls[0].metadata.outcome).toBe('intervention')
    expect(actionCalls[0].metadata.legal_submission).toBe(false)
  })

  test('handler source no longer fabricates complete success for the stub', function () {
    var src = fs.readFileSync(
      path.join(__dirname, '../../worker/handlers/epn-handler.js'),
      'utf8'
    )
    var submitFn = src.split('async function handleErecordSubmit')[1]
    expect(submitFn).toBeTruthy()
    expect(submitFn).not.toMatch(/run_status:\s*'complete'/)
    expect(submitFn).not.toMatch(/success:\s*true/)
    expect(submitFn).toMatch(/run_status:\s*'needs_review'/)
  })
})
