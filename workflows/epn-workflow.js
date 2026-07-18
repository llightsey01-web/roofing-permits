'use strict'

/**
 * Phase 1 — Durable ePN recording workflow.
 *
 * prepare_package (erecord_prepare)
 *   → wait_review (human gate / ErecordReviewApproved)
 *   → submit_epn (erecord_submit)
 *   → wait_recording (RecordingFinished)
 *   → complete
 *
 * Gated by WORKFLOW_ENGINE_EPN=true. Legacy path unchanged when flag is off.
 */

var {
  createWorkflow,
  createWorkflowEngine,
  createStep,
  createWorkflowBridge,
  STEP_TYPE,
  EVENT_NAMES,
} = require('../lib/workflow')

function buildEpnWorkflow(options) {
  var opts = options || {}
  var dryRun = Boolean(opts.dryRun)

  var prepareStep = dryRun
    ? createStep({
        key: 'prepare_package',
        name: 'Prepare ePN Package',
        type: STEP_TYPE.ACTION,
        sequenceOrder: 1,
        handler: async function ({ run, logger, events }) {
          await logger.info('ePN prepare dry-run')
          await events.emitEvent({
            eventName: EVENT_NAMES.ERECORD_PREPARE_COMPLETED,
            runId: run.id,
            jobId: run.job_id,
            companyId: run.company_id,
            source: 'system',
            payload: { dryRun: true },
          })
          return { output: { dryRun: true, prepared: true } }
        },
      })
    : createStep({
        key: 'prepare_package',
        name: 'Prepare ePN Package',
        type: STEP_TYPE.ACTIVITY,
        activityType: 'erecord_prepare',
        sequenceOrder: 1,
        maxAttempts: 3,
        timeoutMs: 45 * 60 * 1000,
      })

  var submitStep = dryRun
    ? createStep({
        key: 'submit_epn',
        name: 'Submit ePN',
        type: STEP_TYPE.ACTION,
        sequenceOrder: 3,
        handler: async function ({ run, logger, events }) {
          await logger.info('ePN submit dry-run')
          await events.emitEvent({
            eventName: EVENT_NAMES.ERECORD_SUBMITTED,
            runId: run.id,
            jobId: run.job_id,
            companyId: run.company_id,
            source: 'system',
            payload: { dryRun: true },
          })
          return { output: { dryRun: true, submitted: true } }
        },
      })
    : createStep({
        key: 'submit_epn',
        name: 'Submit ePN',
        type: STEP_TYPE.ACTIVITY,
        activityType: 'erecord_submit',
        sequenceOrder: 3,
        maxAttempts: 3,
        timeoutMs: 45 * 60 * 1000,
      })

  return createWorkflow({
    key: 'epn',
    name: 'ePN Recording',
    version: 1,
    steps: [
      prepareStep,
      createStep({
        key: 'wait_review',
        name: 'Wait for eRecord Review Approval',
        type: STEP_TYPE.HUMAN_GATE,
        waitForEvent: EVENT_NAMES.ERECORD_REVIEW_APPROVED,
        sequenceOrder: 2,
        maxAttempts: 1,
        timeoutMs: 30 * 24 * 60 * 60 * 1000,
      }),
      submitStep,
      createStep({
        key: 'wait_recording',
        name: 'Wait for Recording Complete',
        type: STEP_TYPE.WEBHOOK_WAIT,
        waitForEvent: EVENT_NAMES.RECORDING_FINISHED,
        sequenceOrder: 4,
        maxAttempts: 1,
        timeoutMs: 14 * 24 * 60 * 60 * 1000,
      }),
      createStep({
        key: 'complete',
        name: 'Complete ePN Workflow',
        type: STEP_TYPE.ACTION,
        sequenceOrder: 5,
        maxAttempts: 1,
        handler: async function ({ run, logger, events }) {
          await logger.info('ePN workflow complete')
          await events.emitEvent({
            eventName: EVENT_NAMES.WORKFLOW_COMPLETED,
            runId: run.id,
            jobId: run.job_id,
            companyId: run.company_id,
            source: 'system',
            payload: { workflowKey: 'epn' },
          })
          return { output: { completed: true } }
        },
      }),
    ],
    meta: {
      phase: 1,
      dryRun: dryRun,
      legacyRunTypes: ['erecord_prepare', 'erecord_submit'],
    },
  })
}

var epnWorkflow = buildEpnWorkflow({ dryRun: false })

async function createEpnActivityDispatcher(engine) {
  var bridge = engine.bridge || createWorkflowBridge({ state: engine.state })

  return async function dispatchActivity(activity, step, run) {
    if (!run.job_id) {
      throw Object.assign(new Error('ePN activity requires jobId'), {
        code: 'NO_JOB_ID',
        retryable: false,
      })
    }

    var legacy = await bridge.enqueueLegacyAutomationRun({
      jobId: run.job_id,
      runType: activity.activity_type,
      workflowRunId: run.id,
      workflowStepId: step.id,
      workflowActivityId: activity.id,
      payload: {
        source: 'epn_workflow',
        stepKey: step.step_key,
        activityId: activity.id,
      },
    })

    await engine.logger.info('ePN dispatched legacy run', {
      legacyRunId: legacy.id,
      runType: activity.activity_type,
    }, { runId: run.id, stepId: step.id })

    await engine.events.emitEvent({
      eventName: EVENT_NAMES.RECORDING_STARTED,
      runId: run.id,
      jobId: run.job_id,
      companyId: run.company_id,
      source: 'system',
      payload: {
        activityType: activity.activity_type,
        legacyRunId: legacy.id,
        stepKey: step.step_key,
      },
    })

    return legacy
  }
}

/**
 * Start durable ePN workflow for a job (idempotent per job).
 */
async function startEpnWorkflow(input) {
  var i = input || {}
  if (!i.jobId) throw new Error('startEpnWorkflow: jobId required')

  var workflow = buildEpnWorkflow({ dryRun: Boolean(i.dryRun) })
  var engine = i.engine || createWorkflowEngine()
  var context = Object.assign({}, i.context || {}, { input: i.input || {} })

  if (i.useLegacyBridge !== false && !i.dryRun) {
    context.dispatchActivity = await createEpnActivityDispatcher(engine)
  }

  var run = await engine.startWorkflow(workflow, {
    jobId: i.jobId,
    companyId: i.companyId,
    idempotencyKey: i.idempotencyKey,
    scope: i.scope || 'epn',
    input: Object.assign({}, i.input || {}, {
      source: i.source || 'manual',
      dependencyRunId: i.dependencyRunId || null,
    }),
    createdBy: i.createdBy,
    triggerRunId: i.triggerRunId,
    autoRun: i.autoRun !== false,
    context: context,
  })

  return { run: run, workflow: workflow, engine: engine }
}

async function resumeEpnWorkflow(runId, options) {
  var o = options || {}
  var workflow = buildEpnWorkflow({ dryRun: Boolean(o.dryRun) })
  var engine = o.engine || createWorkflowEngine()
  var context = Object.assign({}, o.context || {})

  if (o.useLegacyBridge !== false && !o.dryRun) {
    context.dispatchActivity = await createEpnActivityDispatcher(engine)
  }

  return engine.resumeWorkflow(runId, workflow, {
    reason: o.reason,
    actorUserId: o.actorUserId,
    source: o.source || 'admin',
    completeCurrentStep: o.completeCurrentStep !== false,
    stepOutput: o.stepOutput,
    startFromStep: o.startFromStep,
    context: context,
    fromFailed: o.fromFailed,
  })
}

/**
 * Approve eRecord review gate → emits ErecordReviewApproved and resumes.
 */
async function approveEpnReview(runId, options) {
  var o = options || {}
  var engine = o.engine || createWorkflowEngine()
  var run = await engine.state.getRun(runId)
  if (!run) throw new Error('approveEpnReview: run not found')

  await engine.events.emitEvent({
    eventName: EVENT_NAMES.ERECORD_REVIEW_APPROVED,
    runId: runId,
    jobId: run.job_id,
    companyId: run.company_id,
    source: o.source || 'admin',
    externalId: 'review:' + runId,
    payload: {
      approvedBy: o.actorUserId || null,
      reason: o.reason || 'approved',
    },
  })

  return resumeEpnWorkflow(runId, {
    engine: engine,
    reason: o.reason || 'review approved',
    actorUserId: o.actorUserId,
    source: o.source || 'admin',
    completeCurrentStep: true,
    stepOutput: { approved: true },
    dryRun: o.dryRun,
    useLegacyBridge: o.useLegacyBridge,
  })
}

function listEpnSteps() {
  return epnWorkflow.steps.map(function (s) {
    return {
      key: s.key,
      name: s.name,
      type: s.type,
      activityType: s.activityType || null,
      waitForEvent: s.waitForEvent || null,
      sequenceOrder: s.sequenceOrder,
    }
  })
}

module.exports = {
  epnWorkflow: epnWorkflow,
  buildEpnWorkflow: buildEpnWorkflow,
  startEpnWorkflow: startEpnWorkflow,
  resumeEpnWorkflow: resumeEpnWorkflow,
  approveEpnReview: approveEpnReview,
  listEpnSteps: listEpnSteps,
  createEpnActivityDispatcher: createEpnActivityDispatcher,
  EVENT_NAMES: EVENT_NAMES,
}
