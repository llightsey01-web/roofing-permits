'use strict'

/**
 * Full DART iQ permit durable workflow definition.
 *
 * Flow:
 *   Extract → Validate → Generate NOC → Request Signature → Wait Signature
 *   → Start Notary → Wait Notary → Submit ePN → Wait Recording
 *   → County Login → Fill → Upload → Submit → Wait County
 *   → Notify → Complete
 *
 * Activity steps map to existing Railway run_types (noc_generate, proof_send,
 * erecord_submit, permit_phase_1, permit_resume, permit_submit).
 * Wait steps pause on durable events (webhooks / admin resume).
 *
 * Does NOT auto-start legacy automation unless startPermitWorkflow is called
 * with { useLegacyBridge: true }.
 */

var {
  createWorkflow,
  createWorkflowEngine,
  createWorkflowBridge,
  EVENT_NAMES,
  STEP_TYPE,
} = require('../lib/workflow')

var { extractDocumentsStep } = require('./steps/extract-documents')
var { validateDocumentsStep } = require('./steps/validate-documents')
var { generateNocStep, generateNocDryRunStep } = require('./steps/generate-noc')
var {
  requestSignatureStep,
  waitForSignatureStep,
  requestSignatureDryRunStep,
} = require('./steps/request-signature')
var { startNotaryStep, waitForNotaryStep } = require('./steps/start-notary')
var {
  submitEpnStep,
  waitForRecordingStep,
  submitEpnDryRunStep,
} = require('./steps/submit-epn')
var {
  countyLoginStep,
  countyFillFormsStep,
  countyUploadStep,
  countySubmitStep,
  waitForCountyStep,
} = require('./steps/county-submit')
var { notifyCustomerStep, completePermitStep } = require('./steps/notify-customer')

var { voidRecordingCompensation } = require('./compensations/void-recording')
var { cancelSignatureCompensation } = require('./compensations/cancel-signature')

/**
 * Build the permit workflow graph.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] — use non-Playwright stubs for NOC/signature/ePN
 */
function buildPermitWorkflow(options) {
  var opts = options || {}
  var dryRun = Boolean(opts.dryRun)

  var steps = [
    extractDocumentsStep(),
    validateDocumentsStep(),
    dryRun ? generateNocDryRunStep() : generateNocStep(),
    dryRun ? requestSignatureDryRunStep() : requestSignatureStep(),
    waitForSignatureStep(),
    startNotaryStep(),
    waitForNotaryStep(),
    dryRun ? submitEpnDryRunStep() : submitEpnStep(),
    waitForRecordingStep(),
    countyLoginStep(),
    countyFillFormsStep(),
    countyUploadStep(),
    countySubmitStep(),
    waitForCountyStep(),
    notifyCustomerStep(),
    completePermitStep(),
  ]

  // Attach compensations where applicable
  steps = steps.map(function (step) {
    if (step.key === 'submit_epn') {
      step.compensate = voidRecordingCompensation
    }
    if (step.key === 'request_signature') {
      step.compensate = cancelSignatureCompensation
    }
    return step
  })

  return createWorkflow({
    key: 'permit',
    name: 'Permit Processing',
    version: 1,
    steps: steps,
    meta: {
      description: 'End-to-end Florida roofing permit durable workflow',
      dryRun: dryRun,
      eventNames: EVENT_NAMES,
      activityRunTypes: [
        'noc_generate',
        'proof_send',
        'erecord_submit',
        'permit_phase_1',
        'permit_resume',
        'permit_submit',
      ],
    },
  })
}

/**
 * Default production permit workflow (Playwright activities).
 */
var permitWorkflow = buildPermitWorkflow({ dryRun: false })

/**
 * Dispatch a workflow_activities row to legacy automation_runs for Railway workers.
 */
async function createLegacyActivityDispatcher(engine) {
  var bridge = engine.bridge || createWorkflowBridge({ state: engine.state })

  return async function dispatchActivity(activity, step, run) {
    if (!run.job_id) {
      throw Object.assign(new Error('Cannot dispatch Playwright activity without jobId'), {
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
        source: 'permit_workflow',
        stepKey: step.step_key,
        activityId: activity.id,
      },
    })

    await engine.logger.info('Dispatched legacy automation run', {
      legacyRunId: legacy.id,
      runType: activity.activity_type,
      activityId: activity.id,
    }, { runId: run.id, stepId: step.id })

    await engine.events.emitEvent({
      eventName: EVENT_NAMES.COUNTY_SUBMISSION_STARTED,
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
 * Start a permit workflow run.
 * @param {object} input
 * @param {string} input.jobId
 * @param {string} [input.companyId]
 * @param {object} [input.input]
 * @param {boolean} [input.dryRun]
 * @param {boolean} [input.useLegacyBridge] — enqueue automation_runs for activities
 * @param {boolean} [input.autoRun=true]
 * @param {object} [input.engine] — shared engine instance
 */
async function startPermitWorkflow(input) {
  var i = input || {}
  if (!i.jobId) throw new Error('startPermitWorkflow: jobId required')

  var workflow = buildPermitWorkflow({ dryRun: Boolean(i.dryRun) })
  var engine = i.engine || createWorkflowEngine()

  var context = Object.assign({}, i.context || {}, {
    input: i.input || {},
  })

  if (i.useLegacyBridge && !i.dryRun) {
    context.dispatchActivity = await createLegacyActivityDispatcher(engine)
  }

  var run = await engine.startWorkflow(workflow, {
    jobId: i.jobId,
    companyId: i.companyId,
    idempotencyKey: i.idempotencyKey,
    scope: i.scope || 'permit',
    input: i.input || {},
    createdBy: i.createdBy,
    triggerRunId: i.triggerRunId,
    autoRun: i.autoRun !== false,
    context: context,
  })

  return { run: run, workflow: workflow, engine: engine }
}

/**
 * Resume a paused/waiting permit workflow after webhook or admin action.
 */
async function resumePermitWorkflow(runId, options) {
  var o = options || {}
  var workflow = buildPermitWorkflow({ dryRun: Boolean(o.dryRun) })
  var engine = o.engine || createWorkflowEngine()

  var context = Object.assign({}, o.context || {})
  if (o.useLegacyBridge && !o.dryRun) {
    context.dispatchActivity = await createLegacyActivityDispatcher(engine)
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

function listPermitSteps() {
  return permitWorkflow.steps.map(function (s) {
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
  permitWorkflow: permitWorkflow,
  buildPermitWorkflow: buildPermitWorkflow,
  startPermitWorkflow: startPermitWorkflow,
  resumePermitWorkflow: resumePermitWorkflow,
  listPermitSteps: listPermitSteps,
  createLegacyActivityDispatcher: createLegacyActivityDispatcher,
  STEP_TYPE: STEP_TYPE,
  EVENT_NAMES: EVENT_NAMES,
}
