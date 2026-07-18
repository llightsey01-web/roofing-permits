'use strict'

var constants = require('./constants.js')
var retry = require('./workflow-retry.js')
var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')
var { createWorkflowEvents } = require('./workflow-events.js')
var { createWorkflowArtifacts } = require('./workflow-artifacts.js')

/**
 * Define a workflow step (pure definition; not yet bound to a run).
 */
function createStep(definition) {
  var d = definition || {}
  if (!d.key) throw new Error('createStep: key required')

  return {
    key: d.key,
    name: d.name || d.key,
    type: d.type || constants.STEP_TYPE.ACTION,
    sequenceOrder: d.sequenceOrder != null ? d.sequenceOrder : 0,
    maxAttempts: d.maxAttempts != null ? d.maxAttempts : constants.DEFAULT_MAX_ATTEMPTS,
    timeoutMs: d.timeoutMs != null ? d.timeoutMs : null,
    retryable: d.retryable !== false,
    handler: typeof d.handler === 'function' ? d.handler : null,
    compensate: typeof d.compensate === 'function' ? d.compensate : null,
    waitForEvent: d.waitForEvent || null,
    activityType: d.activityType || null,
    meta: d.meta || {},
  }
}

/**
 * Step execution runtime bound to a workflow run.
 */
function createStepRunner(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var logger = opts.logger || createWorkflowLogger({ state: state })
  var events = opts.events || createWorkflowEvents({ state: state, logger: logger })
  var artifacts = opts.artifacts || createWorkflowArtifacts({ state: state, logger: logger })

  /**
   * Execute a step definition against a run. Idempotent if step already succeeded.
   */
  async function executeStep(run, stepDef, context) {
    var ctx = context || {}
    if (!run || !run.id) throw new Error('executeStep: run required')
    if (!stepDef || !stepDef.key) throw new Error('executeStep: stepDef required')

    var step = await state.ensureStep({
      runId: run.id,
      stepKey: stepDef.key,
      stepName: stepDef.name,
      stepType: stepDef.type,
      sequenceOrder: stepDef.sequenceOrder,
      maxAttempts: stepDef.maxAttempts,
      timeoutMs: stepDef.timeoutMs,
      input: ctx.input || {},
    })

    // Idempotency: already succeeded → return cached output
    if (step.status === constants.STEP_STATUS.SUCCEEDED) {
      await logger.info('step already succeeded (idempotent skip): ' + stepDef.key, {}, {
        runId: run.id,
        stepId: step.id,
      })
      return {
        step: step,
        status: constants.STEP_STATUS.SUCCEEDED,
        output: step.output || {},
        skipped: true,
      }
    }

    if (step.status === constants.STEP_STATUS.CANCELLED) {
      var cancelledErr = new Error('Step cancelled: ' + stepDef.key)
      cancelledErr.code = 'STEP_CANCELLED'
      cancelledErr.retryable = false
      throw cancelledErr
    }

    var stepLogger = logger.child({ runId: run.id, stepId: step.id })
    var fromStatus = step.status

    await state.updateRun(run.id, {
      status: constants.RUN_STATUS.RUNNING,
      current_step_key: stepDef.key,
      started_at: run.started_at || new Date().toISOString(),
    })

    async function runOnce(attempt) {
      step = await state.updateStep(step.id, {
        status: constants.STEP_STATUS.RUNNING,
        attempt_count: attempt,
        started_at: step.started_at || new Date().toISOString(),
        error_message: null,
        error_code: null,
      })

      await state.appendStepHistory({
        runId: run.id,
        stepId: step.id,
        attemptNumber: attempt,
        fromStatus: fromStatus,
        toStatus: constants.STEP_STATUS.RUNNING,
        eventType: attempt === 1 ? 'started' : 'retried',
        message: 'Step ' + stepDef.key + ' attempt ' + attempt,
      })

      await stepLogger.info('step started: ' + stepDef.key, { attempt: attempt })

      // Wait / webhook / human gate steps
      if (
        stepDef.type === constants.STEP_TYPE.WAIT ||
        stepDef.type === constants.STEP_TYPE.WEBHOOK_WAIT ||
        stepDef.type === constants.STEP_TYPE.HUMAN_GATE ||
        stepDef.waitForEvent
      ) {
        var eventName = stepDef.waitForEvent || (ctx.wait && ctx.wait.eventName)
        if (!eventName) {
          throw Object.assign(new Error('Wait step missing waitForEvent'), {
            code: 'WAIT_CONFIG',
            retryable: false,
          })
        }

        // Race-safe: webhook may have arrived before this wait registered
        var preexisting = await events.findEvent({
          eventName: eventName,
          runId: run.id,
          unprocessedOnly: true,
        })
        if (!preexisting && run.job_id) {
          preexisting = await events.findEvent({
            eventName: eventName,
            jobId: run.job_id,
            unprocessedOnly: true,
          })
        }

        if (preexisting) {
          await events.markEventProcessed(preexisting.id)
          return {
            waiting: false,
            event: preexisting,
            output: Object.assign({}, preexisting.payload || {}, { matchedPreexistingEvent: true }),
          }
        }

        await state.updateStep(step.id, { status: constants.STEP_STATUS.WAITING })
        await state.updateRun(run.id, {
          status: constants.RUN_STATUS.WAITING,
          pause_reason: ctx.pauseReason || null,
          paused_at: new Date().toISOString(),
          resume_token: ctx.resumeToken || eventName + ':' + run.id,
        })

        await events.emitEvent({
          eventName: constants.EVENT_NAMES.WORKFLOW_PAUSED,
          runId: run.id,
          jobId: run.job_id,
          companyId: run.company_id,
          source: 'system',
          payload: { stepKey: stepDef.key, waitingFor: eventName },
        })

        if (ctx.skipWait) {
          return {
            waiting: true,
            eventName: eventName,
            message: 'Wait registered without blocking (orchestrator will resume)',
          }
        }

        var event = await events.waitForEvent({
          eventName: eventName,
          runId: run.id,
          jobId: run.job_id,
          timeoutMs: stepDef.timeoutMs || ctx.waitTimeoutMs,
          pollMs: ctx.pollMs,
        })

        return { waiting: false, event: event, output: event.payload || {} }
      }

      // Browser / Railway activity step
      if (stepDef.type === constants.STEP_TYPE.ACTIVITY || stepDef.activityType) {
        var activity = await state.enqueueActivity({
          runId: run.id,
          stepId: step.id,
          stepKey: stepDef.key,
          activityType: stepDef.activityType || stepDef.key,
          payload: Object.assign({}, ctx.input || {}, {
            jobId: run.job_id,
            companyId: run.company_id,
            workflowRunId: run.id,
            workflowStepId: step.id,
          }),
          attempt: attempt,
        })

        if (typeof ctx.dispatchActivity === 'function') {
          await ctx.dispatchActivity(activity, step, run)
        }

        if (ctx.skipActivityWait) {
          await state.updateStep(step.id, { status: constants.STEP_STATUS.WAITING })
          return {
            waiting: true,
            activity: activity,
            message: 'Activity queued; orchestrator waits for ActivityCompleted',
          }
        }

        return { activity: activity, output: { activityId: activity.id } }
      }

      // Standard action handler
      if (typeof stepDef.handler !== 'function') {
        throw Object.assign(new Error('Step has no handler: ' + stepDef.key), {
          code: 'NO_HANDLER',
          retryable: false,
        })
      }

      var result = await stepDef.handler({
        run: run,
        step: step,
        attempt: attempt,
        input: ctx.input || step.input || {},
        state: state,
        logger: stepLogger,
        events: events,
        artifacts: artifacts,
        context: ctx,
      })

      return result || {}
    }

    try {
      var output = await retry.withStepRetry(runOnce, {
        maxAttempts: stepDef.maxAttempts || constants.DEFAULT_MAX_ATTEMPTS,
        baseDelayMs: ctx.baseDelayMs,
        maxDelayMs: ctx.maxDelayMs,
        label: stepDef.key,
        shouldRetry: function (err) {
          if (stepDef.retryable === false) return false
          if (err && err.retryable === false) return false
          return true
        },
        onError: async function (err, attempt, willRetry) {
          await state.appendRetryHistory({
            runId: run.id,
            stepId: step.id,
            attemptNumber: attempt,
            delayMs: retry.computeBackoffMs(attempt, ctx),
            errorMessage: err.message,
            errorCode: err.code || null,
            willRetry: willRetry,
          })
          await stepLogger.warn('step attempt failed: ' + stepDef.key, {
            attempt: attempt,
            willRetry: willRetry,
            error: err.message,
          })
        },
      })

      // Non-blocking wait/activity registration
      if (output && output.waiting) {
        return {
          step: await state.getStep(run.id, stepDef.key),
          status: constants.STEP_STATUS.WAITING,
          output: output,
          waiting: true,
        }
      }

      var succeeded = await state.updateStep(step.id, {
        status: constants.STEP_STATUS.SUCCEEDED,
        output: output.output || output || {},
        completed_at: new Date().toISOString(),
        error_message: null,
        error_code: null,
      })

      await state.appendStepHistory({
        runId: run.id,
        stepId: step.id,
        attemptNumber: succeeded.attempt_count || 1,
        fromStatus: constants.STEP_STATUS.RUNNING,
        toStatus: constants.STEP_STATUS.SUCCEEDED,
        eventType: 'succeeded',
        message: 'Step succeeded: ' + stepDef.key,
        payload: succeeded.output || {},
      })

      await stepLogger.info('step succeeded: ' + stepDef.key, {})

      return {
        step: succeeded,
        status: constants.STEP_STATUS.SUCCEEDED,
        output: succeeded.output || {},
        waiting: false,
      }
    } catch (err) {
      var failed = await state.updateStep(step.id, {
        status: constants.STEP_STATUS.FAILED,
        error_message: err.message,
        error_code: err.code || null,
        completed_at: new Date().toISOString(),
      })

      await state.appendStepHistory({
        runId: run.id,
        stepId: step.id,
        attemptNumber: failed.attempt_count || 1,
        fromStatus: constants.STEP_STATUS.RUNNING,
        toStatus: constants.STEP_STATUS.FAILED,
        eventType: 'failed',
        message: err.message,
      })

      await state.recordFailure({
        runId: run.id,
        stepId: step.id,
        failureType: err.failureType || classifyFailure(err),
        errorCode: err.code || null,
        errorMessage: err.message,
        stack: err.stack || null,
        isRetryable: err.retryable !== false,
      })

      await state.updateRun(run.id, {
        status: constants.RUN_STATUS.FAILED,
        error_message: err.message,
        error_code: err.code || null,
      })

      await events.emitEvent({
        eventName: constants.EVENT_NAMES.WORKFLOW_FAILED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { stepKey: stepDef.key, error: err.message },
      })

      await stepLogger.error('step failed: ' + stepDef.key, { error: err.message })
      throw err
    }
  }

  async function compensateStep(run, stepDef, context) {
    if (!stepDef || typeof stepDef.compensate !== 'function') {
      return { skipped: true, reason: 'no_compensation' }
    }
    var step = await state.getStep(run.id, stepDef.key)
    if (!step) return { skipped: true, reason: 'step_missing' }

    var result = await stepDef.compensate({
      run: run,
      step: step,
      input: (context && context.input) || {},
      state: state,
      logger: logger.child({ runId: run.id, stepId: step.id }),
      events: events,
      artifacts: artifacts,
    })

    await state.updateStep(step.id, {
      status: constants.STEP_STATUS.COMPENSATED,
      output: Object.assign({}, step.output || {}, { compensation: result || {} }),
      completed_at: new Date().toISOString(),
    })

    return { compensated: true, result: result }
  }

  return {
    createStep: createStep,
    executeStep: executeStep,
    compensateStep: compensateStep,
  }
}

function classifyFailure(err) {
  var msg = String((err && err.message) || '').toLowerCase()
  if (err && err.failureType) return err.failureType
  if (/timeout|timed out/.test(msg)) return 'timeout'
  if (/playwright|browser|target closed|chromium/.test(msg)) return 'playwright_crash'
  if (/429|rate limit/.test(msg)) return 'provider'
  if (/network|fetch failed|econnreset|enotfound/.test(msg)) return 'network'
  if (/validat/.test(msg)) return 'validation'
  return 'unknown'
}

module.exports = {
  createStep: createStep,
  createStepRunner: createStepRunner,
  classifyFailure: classifyFailure,
}
