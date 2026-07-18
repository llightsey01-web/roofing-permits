'use strict'

/**
 * DART iQ durable workflow engine (Trigger.dev control plane + Supabase state).
 *
 * Public API:
 *   createWorkflowEngine()
 *   createWorkflow()
 *   createStep()
 *   waitForEvent / emitEvent / pause / resume / cancel / retry
 */

var constants = require('./constants.js')
var idempotency = require('./workflow-idempotency.js')
var retry = require('./workflow-retry.js')
var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')
var { createWorkflowEvents, EVENT_NAMES } = require('./workflow-events.js')
var { createWorkflowArtifacts } = require('./workflow-artifacts.js')
var { createWorkflowBridge } = require('./workflow-bridge.js')
var { createStep, createStepRunner, classifyFailure } = require('./workflow-step.js')
var {
  createWorkflow,
  createWorkflowEngine,
} = require('./workflow-engine.js')
var featureFlags = require('./feature-flags.js')

function createEngine(options) {
  return createWorkflowEngine(options)
}

module.exports = {
  // factories
  createWorkflowEngine: createWorkflowEngine,
  createEngine: createEngine,
  createWorkflow: createWorkflow,
  createStep: createStep,
  createStepRunner: createStepRunner,
  createWorkflowState: createWorkflowState,
  createWorkflowLogger: createWorkflowLogger,
  createWorkflowEvents: createWorkflowEvents,
  createWorkflowArtifacts: createWorkflowArtifacts,
  createWorkflowBridge: createWorkflowBridge,

  // retry / idempotency
  withStepRetry: retry.withStepRetry,
  retryStep: retry.retryStep,
  computeBackoffMs: retry.computeBackoffMs,
  buildIdempotencyKey: idempotency.buildIdempotencyKey,
  workflowRunKey: idempotency.workflowRunKey,
  stepKey: idempotency.stepKey,
  eventKey: idempotency.eventKey,
  activityKey: idempotency.activityKey,
  webhookEventKey: idempotency.webhookEventKey,
  classifyFailure: classifyFailure,

  // durable webhooks
  authorizeWebhook: require('./webhook-auth.js').authorizeWebhook,
  ingestAndResume: require('./webhook-intake.js').ingestAndResume,
  handleWebhookHttp: require('./webhook-intake.js').handleWebhookHttp,
  webhooks: require('./webhooks.js'),

  // feature flags
  isWorkflowEngineEpnEnabled: featureFlags.isWorkflowEngineEpnEnabled,
  featureFlags: featureFlags,

  // admin
  adminService: require('./admin-service.js'),

  // constants
  RUN_STATUS: constants.RUN_STATUS,
  STEP_STATUS: constants.STEP_STATUS,
  STEP_TYPE: constants.STEP_TYPE,
  ACTIVITY_STATUS: constants.ACTIVITY_STATUS,
  EVENT_NAMES: EVENT_NAMES,
  PAUSE_REASONS: constants.PAUSE_REASONS,
}
