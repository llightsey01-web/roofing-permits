'use strict'

var constants = require('./constants.js')
var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')
var { createWorkflowEvents } = require('./workflow-events.js')
var { createWorkflowArtifacts } = require('./workflow-artifacts.js')
var { createWorkflowBridge } = require('./workflow-bridge.js')
var { createStep, createStepRunner } = require('./workflow-step.js')

/**
 * Define a workflow graph.
 * @param {object} definition
 * @param {string} definition.key
 * @param {string} [definition.name]
 * @param {Array} definition.steps — createStep() definitions
 */
function createWorkflow(definition) {
  var d = definition || {}
  if (!d.key) throw new Error('createWorkflow: key required')
  if (!Array.isArray(d.steps) || d.steps.length === 0) {
    throw new Error('createWorkflow: steps[] required')
  }

  var steps = d.steps.map(function (s, idx) {
    var step = createStep(s)
    if (step.sequenceOrder == null || step.sequenceOrder === 0) {
      // Preserve explicit 0; only default when missing from definition
      if (s.sequenceOrder == null) step.sequenceOrder = idx
    }
    return step
  })

  var byKey = {}
  steps.forEach(function (s) {
    if (byKey[s.key]) throw new Error('Duplicate step key: ' + s.key)
    byKey[s.key] = s
  })

  return {
    key: d.key,
    name: d.name || d.key,
    version: d.version || 1,
    steps: steps,
    stepsByKey: byKey,
    meta: d.meta || {},
  }
}

/**
 * Core workflow engine — start / pause / resume / cancel / run steps.
 * Trigger.dev tasks will call into this; existing automation remains untouched.
 */
function createWorkflowEngine(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var logger = opts.logger || createWorkflowLogger({ state: state })
  var events = opts.events || createWorkflowEvents({ state: state, logger: logger })
  var artifacts = opts.artifacts || createWorkflowArtifacts({ state: state, logger: logger })
  var bridge = opts.bridge || createWorkflowBridge({ state: state })
  var stepRunner = createStepRunner({
    state: state,
    logger: logger,
    events: events,
    artifacts: artifacts,
  })

  /**
   * Start (or idempotently return) a workflow run, seed steps, optionally execute.
   */
  async function startWorkflow(workflow, input) {
    var i = input || {}
    if (!workflow || !workflow.key) throw new Error('startWorkflow: workflow required')

    var run = await state.createRun({
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
      jobId: i.jobId,
      companyId: i.companyId,
      triggerRunId: i.triggerRunId,
      legacyRunId: i.legacyRunId,
      idempotencyKey: i.idempotencyKey,
      scope: i.scope,
      input: i.input || {},
      createdBy: i.createdBy,
      status: constants.RUN_STATUS.QUEUED,
    })

    // Seed all steps (pending) for admin visibility
    for (var idx = 0; idx < workflow.steps.length; idx++) {
      var s = workflow.steps[idx]
      await state.ensureStep({
        runId: run.id,
        stepKey: s.key,
        stepName: s.name,
        stepType: s.type,
        sequenceOrder: s.sequenceOrder != null ? s.sequenceOrder : idx,
        maxAttempts: s.maxAttempts,
        timeoutMs: s.timeoutMs,
        input: {},
      })
    }

    await logger.info('workflow started: ' + workflow.key, {
      runId: run.id,
      jobId: run.job_id,
    }, { runId: run.id })

    if (workflow.key === 'permit') {
      await events.emitEvent({
        eventName: constants.EVENT_NAMES.PERMIT_CREATED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { workflowKey: workflow.key },
      })
    }

    if (i.autoRun !== false) {
      run = await runWorkflow(workflow, run.id, {
        startFromStep: i.startFromStep || null,
        context: i.context || {},
      })
    }

    return run
  }

  /**
   * Execute steps in order until wait/failure/completion.
   */
  async function runWorkflow(workflow, runId, options) {
    var o = options || {}
    var run = await state.getRun(runId)
    if (!run) throw new Error('runWorkflow: run not found')

    if (
      run.status === constants.RUN_STATUS.CANCELLED ||
      run.status === constants.RUN_STATUS.COMPLETED
    ) {
      return run
    }

    var startIdx = 0
    if (o.startFromStep) {
      startIdx = workflow.steps.findIndex(function (s) {
        return s.key === o.startFromStep
      })
      if (startIdx < 0) throw new Error('Unknown startFromStep: ' + o.startFromStep)
    } else if (run.current_step_key) {
      // Resume after wait: find first non-succeeded step
      for (var i = 0; i < workflow.steps.length; i++) {
        var existing = await state.getStep(run.id, workflow.steps[i].key)
        if (!existing || existing.status !== constants.STEP_STATUS.SUCCEEDED) {
          startIdx = i
          break
        }
        startIdx = i + 1
      }
    }

    run = await state.updateRun(run.id, {
      status: constants.RUN_STATUS.RUNNING,
      started_at: run.started_at || new Date().toISOString(),
      error_message: null,
      error_code: null,
    })

    for (var idx = startIdx; idx < workflow.steps.length; idx++) {
      var stepDef = workflow.steps[idx]
      var latest = await state.getRun(run.id)
      if (latest.status === constants.RUN_STATUS.CANCELLED) return latest

      var result = await stepRunner.executeStep(latest, stepDef, Object.assign({}, o.context || {}, {
        skipWait: o.skipWait !== false, // default: register wait without blocking event loop
        skipActivityWait: o.skipActivityWait !== false,
        dispatchActivity: o.dispatchActivity,
        pauseReason: inferPauseReason(stepDef),
      }))

      run = await state.getRun(run.id)

      if (result.waiting) {
        return state.updateRun(run.id, {
          status:
            stepDef.type === constants.STEP_TYPE.HUMAN_GATE
              ? constants.RUN_STATUS.PAUSED
              : constants.RUN_STATUS.WAITING,
          current_step_key: stepDef.key,
          pause_reason: inferPauseReason(stepDef),
          paused_at: new Date().toISOString(),
        })
      }
    }

    run = await state.updateRun(run.id, {
      status: constants.RUN_STATUS.COMPLETED,
      current_step_key: null,
      completed_at: new Date().toISOString(),
      pause_reason: null,
      paused_at: null,
    })

    await events.emitEvent({
      eventName: constants.EVENT_NAMES.WORKFLOW_COMPLETED,
      runId: run.id,
      jobId: run.job_id,
      companyId: run.company_id,
      source: 'system',
      payload: { workflowKey: workflow.key },
    })

    await logger.info('workflow completed: ' + workflow.key, {}, { runId: run.id })
    return run
  }

  async function pauseWorkflow(runId, reason, actor) {
    var run = await state.updateRun(runId, {
      status: constants.RUN_STATUS.PAUSED,
      pause_reason: reason || constants.PAUSE_REASONS.MANUAL,
      paused_at: new Date().toISOString(),
    })
    await state.recordManualOverride({
      runId: runId,
      action: 'pause',
      reason: reason || 'manual pause',
      actorUserId: actor && actor.userId,
    })
    await events.emitEvent({
      eventName: constants.EVENT_NAMES.WORKFLOW_PAUSED,
      runId: runId,
      jobId: run.job_id,
      companyId: run.company_id,
      source: 'admin',
      payload: { reason: reason || 'manual' },
    })
    return run
  }

  async function resumeWorkflow(runId, workflow, options) {
    var o = options || {}
    var run = await state.getRun(runId)
    if (!run) throw new Error('resumeWorkflow: run not found')

    if (
      run.status !== constants.RUN_STATUS.PAUSED &&
      run.status !== constants.RUN_STATUS.WAITING &&
      run.status !== constants.RUN_STATUS.FAILED
    ) {
      // Allow resume from failed only with explicit flag
      if (!(run.status === constants.RUN_STATUS.FAILED && o.fromFailed)) {
        throw new Error('resumeWorkflow: invalid status ' + run.status)
      }
    }

    await state.recordManualOverride({
      runId: runId,
      action: 'resume',
      reason: o.reason || 'resume',
      actorUserId: o.actorUserId,
      payload: { startFromStep: o.startFromStep || run.current_step_key },
    })

    // If waiting on a step, mark it succeeded when resume event provided
    if (o.completeCurrentStep && run.current_step_key) {
      var step = await state.getStep(runId, run.current_step_key)
      if (step && (step.status === constants.STEP_STATUS.WAITING || step.status === constants.STEP_STATUS.PAUSED)) {
        await state.updateStep(step.id, {
          status: constants.STEP_STATUS.SUCCEEDED,
          output: Object.assign({}, step.output || {}, o.stepOutput || {}),
          completed_at: new Date().toISOString(),
        })
      }
    }

    await state.updateRun(runId, {
      status: constants.RUN_STATUS.RUNNING,
      pause_reason: null,
      paused_at: null,
      error_message: null,
    })

    await events.emitEvent({
      eventName: constants.EVENT_NAMES.WORKFLOW_RESUMED,
      runId: runId,
      jobId: run.job_id,
      companyId: run.company_id,
      source: o.source || 'admin',
      payload: { startFromStep: o.startFromStep || null },
    })

    if (!workflow) return state.getRun(runId)
    return runWorkflow(workflow, runId, {
      startFromStep: o.startFromStep || null,
      context: o.context || {},
      skipWait: o.skipWait,
      skipActivityWait: o.skipActivityWait,
      dispatchActivity: o.dispatchActivity,
    })
  }

  async function cancelWorkflow(runId, reason, actor) {
    var run = await state.updateRun(runId, {
      status: constants.RUN_STATUS.CANCELLED,
      cancelled_at: new Date().toISOString(),
      error_message: reason || 'cancelled',
    })

    var steps = await state.listSteps(runId)
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i]
      if (
        s.status === constants.STEP_STATUS.PENDING ||
        s.status === constants.STEP_STATUS.RUNNING ||
        s.status === constants.STEP_STATUS.WAITING ||
        s.status === constants.STEP_STATUS.PAUSED
      ) {
        await state.updateStep(s.id, {
          status: constants.STEP_STATUS.CANCELLED,
          completed_at: new Date().toISOString(),
        })
      }
    }

    await state.recordManualOverride({
      runId: runId,
      action: 'cancel',
      reason: reason || 'cancelled',
      actorUserId: actor && actor.userId,
    })

    await events.emitEvent({
      eventName: constants.EVENT_NAMES.WORKFLOW_CANCELLED,
      runId: runId,
      jobId: run.job_id,
      companyId: run.company_id,
      source: 'admin',
      payload: { reason: reason || 'cancelled' },
    })

    return run
  }

  async function retryStep(runId, stepKey, workflow, options) {
    var o = options || {}
    var step = await state.getStep(runId, stepKey)
    if (!step) throw new Error('retryStep: step not found')

    await state.updateStep(step.id, {
      status: constants.STEP_STATUS.PENDING,
      error_message: null,
      error_code: null,
      completed_at: null,
      next_retry_at: null,
    })

    await state.recordManualOverride({
      runId: runId,
      stepId: step.id,
      action: 'retry',
      reason: o.reason || 'retry step',
      actorUserId: o.actorUserId,
      payload: { stepKey: stepKey },
    })

    await state.updateRun(runId, {
      status: constants.RUN_STATUS.RUNNING,
      current_step_key: stepKey,
      error_message: null,
    })

    if (!workflow) return state.getRun(runId)
    return runWorkflow(workflow, runId, {
      startFromStep: stepKey,
      context: o.context || {},
      skipWait: o.skipWait,
      skipActivityWait: o.skipActivityWait,
      dispatchActivity: o.dispatchActivity,
    })
  }

  async function restartFromStep(runId, stepKey, workflow, options) {
    var o = options || {}
    if (!workflow) throw new Error('restartFromStep: workflow required')

    var startIdx = workflow.steps.findIndex(function (s) {
      return s.key === stepKey
    })
    if (startIdx < 0) throw new Error('restartFromStep: unknown step ' + stepKey)

    // Reset target step and all following steps
    for (var i = startIdx; i < workflow.steps.length; i++) {
      var s = workflow.steps[i]
      var existing = await state.getStep(runId, s.key)
      if (existing) {
        await state.updateStep(existing.id, {
          status: constants.STEP_STATUS.PENDING,
          output: {},
          error_message: null,
          error_code: null,
          completed_at: null,
          started_at: null,
          attempt_count: 0,
        })
      }
    }

    await state.recordManualOverride({
      runId: runId,
      action: 'restart_from_step',
      reason: o.reason || 'restart from step',
      actorUserId: o.actorUserId,
      payload: { stepKey: stepKey },
    })

    return runWorkflow(workflow, runId, {
      startFromStep: stepKey,
      context: o.context || {},
      skipWait: o.skipWait,
      skipActivityWait: o.skipActivityWait,
      dispatchActivity: o.dispatchActivity,
    })
  }

  async function forceNextStep(runId, workflow, options) {
    var o = options || {}
    var run = await state.getRun(runId)
    if (!run) throw new Error('forceNextStep: run not found')
    if (!run.current_step_key) throw new Error('forceNextStep: no current step')

    var step = await state.getStep(runId, run.current_step_key)
    if (step) {
      await state.updateStep(step.id, {
        status: constants.STEP_STATUS.SUCCEEDED,
        output: Object.assign({}, step.output || {}, { forced: true }, o.stepOutput || {}),
        completed_at: new Date().toISOString(),
      })
    }

    await state.recordManualOverride({
      runId: runId,
      stepId: step && step.id,
      action: 'force_next_step',
      reason: o.reason || 'force next step',
      actorUserId: o.actorUserId,
      payload: { fromStep: run.current_step_key },
    })

    if (!workflow) return state.getRun(runId)

    var idx = workflow.steps.findIndex(function (s) {
      return s.key === run.current_step_key
    })
    var next = workflow.steps[idx + 1]
    return runWorkflow(workflow, runId, {
      startFromStep: next ? next.key : null,
      context: o.context || {},
      skipWait: o.skipWait,
      skipActivityWait: o.skipActivityWait,
      dispatchActivity: o.dispatchActivity,
    })
  }

  return {
    state: state,
    logger: logger,
    events: events,
    artifacts: artifacts,
    bridge: bridge,
    stepRunner: stepRunner,
    createWorkflow: createWorkflow,
    createStep: createStep,
    startWorkflow: startWorkflow,
    runWorkflow: runWorkflow,
    pauseWorkflow: pauseWorkflow,
    resumeWorkflow: resumeWorkflow,
    cancelWorkflow: cancelWorkflow,
    retryStep: retryStep,
    restartFromStep: restartFromStep,
    forceNextStep: forceNextStep,
  }
}

function inferPauseReason(stepDef) {
  if (!stepDef) return constants.PAUSE_REASONS.MANUAL
  var key = String(stepDef.key || '').toLowerCase()
  var wait = String(stepDef.waitForEvent || '').toLowerCase()
  if (/signature/.test(key + wait)) return constants.PAUSE_REASONS.SIGNATURE
  if (/notary|notar/.test(key + wait)) return constants.PAUSE_REASONS.NOTARY
  if (/record/.test(key + wait)) return constants.PAUSE_REASONS.RECORDING
  if (/county|permit/.test(key + wait)) return constants.PAUSE_REASONS.COUNTY
  if (/payment/.test(key + wait)) return constants.PAUSE_REASONS.PAYMENT
  if (stepDef.type === constants.STEP_TYPE.HUMAN_GATE) return constants.PAUSE_REASONS.MANUAL
  return null
}

module.exports = {
  createWorkflow: createWorkflow,
  createWorkflowEngine: createWorkflowEngine,
  RUN_STATUS: constants.RUN_STATUS,
  STEP_STATUS: constants.STEP_STATUS,
  EVENT_NAMES: constants.EVENT_NAMES,
}
