'use strict'

const crypto = require('crypto')

/**
 * Deterministic idempotency key from stable parts.
 * Same inputs → same key (safe for retries / duplicate webhooks).
 */
function buildIdempotencyKey(parts) {
  var list = (Array.isArray(parts) ? parts : [parts])
    .map(function (p) {
      if (p == null) return ''
      if (typeof p === 'object') return JSON.stringify(p)
      return String(p)
    })
    .join('|')

  return crypto.createHash('sha256').update(list).digest('hex').slice(0, 40)
}

function workflowRunKey(opts) {
  var o = opts || {}
  return buildIdempotencyKey([
    'workflow_run',
    o.workflowKey,
    o.workflowVersion || 1,
    o.jobId || '',
    o.companyId || '',
    o.scope || 'default',
  ])
}

function stepKey(opts) {
  var o = opts || {}
  return buildIdempotencyKey([
    'workflow_step',
    o.runId,
    o.stepKey,
  ])
}

function eventKey(opts) {
  var o = opts || {}
  return buildIdempotencyKey([
    'workflow_event',
    o.eventName,
    o.runId || '',
    o.jobId || '',
    o.externalId || o.payloadHash || '',
  ])
}

function activityKey(opts) {
  var o = opts || {}
  return buildIdempotencyKey([
    'workflow_activity',
    o.runId,
    o.stepKey,
    o.activityType,
    o.attempt || 1,
  ])
}

function webhookEventKey(opts) {
  var o = opts || {}
  return buildIdempotencyKey([
    'webhook',
    o.provider || 'unknown',
    o.eventType || '',
    o.externalId || o.deliveryId || '',
  ])
}

module.exports = {
  buildIdempotencyKey: buildIdempotencyKey,
  workflowRunKey: workflowRunKey,
  stepKey: stepKey,
  eventKey: eventKey,
  activityKey: activityKey,
  webhookEventKey: webhookEventKey,
}
