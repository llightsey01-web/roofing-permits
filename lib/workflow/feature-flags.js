'use strict'

/**
 * Feature flags for incremental durable-workflow migration.
 * Default OFF — existing automation_runs path stays production.
 */

function envFlagTrue(name) {
  var v = String(process.env[name] || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/** Phase 1 — route Proof→ePN handoff through durable epn workflow */
function isWorkflowEngineEpnEnabled() {
  return envFlagTrue('WORKFLOW_ENGINE_EPN')
}

/** Future phases */
function isWorkflowEngineNotaryEnabled() {
  return envFlagTrue('WORKFLOW_ENGINE_NOTARY')
}

function isWorkflowEngineCountyEnabled() {
  return envFlagTrue('WORKFLOW_ENGINE_COUNTY')
}

function isWorkflowEngineNotificationsEnabled() {
  return envFlagTrue('WORKFLOW_ENGINE_NOTIFICATIONS')
}

function isWorkflowEngineAiExtractionEnabled() {
  return envFlagTrue('WORKFLOW_ENGINE_AI_EXTRACTION')
}

module.exports = {
  envFlagTrue: envFlagTrue,
  isWorkflowEngineEpnEnabled: isWorkflowEngineEpnEnabled,
  isWorkflowEngineNotaryEnabled: isWorkflowEngineNotaryEnabled,
  isWorkflowEngineCountyEnabled: isWorkflowEngineCountyEnabled,
  isWorkflowEngineNotificationsEnabled: isWorkflowEngineNotificationsEnabled,
  isWorkflowEngineAiExtractionEnabled: isWorkflowEngineAiExtractionEnabled,
}
