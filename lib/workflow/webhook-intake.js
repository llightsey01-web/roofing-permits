'use strict'

/**
 * Durable webhook intake:
 * 1) Correlate to job / waiting workflow run
 * 2) Persist workflow_events (idempotent)
 * 3) Resume matching waiting/paused runs
 */

var constants = require('./constants.js')
var { createWorkflowEngine } = require('./workflow-engine.js')
var { authorizeWebhook } = require('./webhook-auth.js')

var EVENT_NAMES = constants.EVENT_NAMES
var RUN_STATUS = constants.RUN_STATUS

var EVENT_TO_WORKFLOW_HINTS = {}
EVENT_TO_WORKFLOW_HINTS[EVENT_NAMES.SIGNATURE_COMPLETED] = ['permit']
EVENT_TO_WORKFLOW_HINTS[EVENT_NAMES.NOTARY_COMPLETED] = ['permit']
EVENT_TO_WORKFLOW_HINTS[EVENT_NAMES.RECORDING_FINISHED] = ['epn', 'permit']
EVENT_TO_WORKFLOW_HINTS[EVENT_NAMES.COUNTY_SUBMISSION_COMPLETED] = ['permit']
EVENT_TO_WORKFLOW_HINTS[EVENT_NAMES.ERECORD_REVIEW_APPROVED] = ['epn']

function pick(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (obj && obj[k] != null && obj[k] !== '') return obj[k]
  }
  return null
}

function asPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

/**
 * Normalize provider webhook bodies into a common shape.
 */
function normalizeWebhookBody(body, defaults) {
  var b = asPlainObject(body)
  var data = asPlainObject(b.data || b.payload || b.event || {})
  var d = defaults || {}

  return {
    jobId: pick(b, ['job_id', 'jobId']) || pick(data, ['job_id', 'jobId']) || d.jobId || null,
    runId:
      pick(b, ['run_id', 'runId', 'workflow_run_id', 'workflowRunId']) ||
      pick(data, ['run_id', 'runId', 'workflow_run_id', 'workflowRunId']) ||
      d.runId ||
      null,
    companyId:
      pick(b, ['company_id', 'companyId']) ||
      pick(data, ['company_id', 'companyId']) ||
      d.companyId ||
      null,
    externalId:
      pick(b, [
        'external_id',
        'externalId',
        'transaction_id',
        'transactionId',
        'package_id',
        'packageId',
        'packId',
        'pack_id',
        'id',
      ]) ||
      pick(data, [
        'external_id',
        'externalId',
        'transaction_id',
        'transactionId',
        'package_id',
        'packageId',
        'packId',
        'pack_id',
        'id',
      ]) ||
      d.externalId ||
      null,
    deliveryId:
      pick(b, ['delivery_id', 'deliveryId', 'webhook_id', 'webhookId', 'event_id', 'eventId']) ||
      pick(data, ['delivery_id', 'deliveryId', 'webhook_id', 'webhookId', 'event_id', 'eventId']) ||
      d.deliveryId ||
      null,
    eventType:
      pick(b, ['event_type', 'eventType', 'type', 'status']) ||
      pick(data, ['event_type', 'eventType', 'type', 'status']) ||
      d.eventType ||
      null,
    transactionId:
      pick(b, ['transaction_id', 'transactionId']) ||
      pick(data, ['transaction_id', 'transactionId']) ||
      null,
    packageId:
      pick(b, ['package_id', 'packageId', 'packId', 'pack_id']) ||
      pick(data, ['package_id', 'packageId', 'packId', 'pack_id']) ||
      null,
    recordingNumber:
      pick(b, ['recording_number', 'recordingNumber']) ||
      pick(data, ['recording_number', 'recordingNumber']) ||
      null,
    raw: b,
  }
}

async function resolveJobId(engine, normalized) {
  if (normalized.jobId) return normalized.jobId

  if (normalized.transactionId) {
    var byTx = await engine.state.findJobIdByProofTransaction(normalized.transactionId)
    if (byTx) return byTx
  }

  if (normalized.packageId) {
    var byPack = await engine.state.findJobIdByErecordPackage(normalized.packageId)
    if (byPack) return byPack
  }

  return null
}

async function resumeRun(engine, run, options) {
  var o = options || {}
  var workflows = require('../../workflows/index.js')

  if (run.workflow_key === 'epn') {
    return workflows.resumeEpnWorkflow(run.id, {
      engine: engine,
      reason: o.reason || 'webhook: ' + (o.eventName || 'event'),
      source: 'webhook',
      completeCurrentStep: true,
      stepOutput: o.stepOutput || {},
      useLegacyBridge: o.useLegacyBridge !== false,
      dryRun: Boolean(o.dryRun),
    })
  }

  if (run.workflow_key === 'permit') {
    return workflows.resumePermitWorkflow(run.id, {
      engine: engine,
      reason: o.reason || 'webhook: ' + (o.eventName || 'event'),
      source: 'webhook',
      completeCurrentStep: true,
      stepOutput: o.stepOutput || {},
      useLegacyBridge: Boolean(o.useLegacyBridge),
      dryRun: Boolean(o.dryRun),
    })
  }

  // Generic resume without continuing step graph beyond current wait
  return engine.resumeWorkflow(run.id, null, {
    reason: o.reason || 'webhook',
    source: 'webhook',
    completeCurrentStep: true,
    stepOutput: o.stepOutput || {},
  })
}

/**
 * Core intake used by HTTP routes and internal callers (workers).
 *
 * @param {object} input
 * @param {string} input.provider - proof | epn | county | system
 * @param {string} input.eventName - durable EVENT_NAMES value
 * @param {object} [input.body]
 * @param {boolean} [input.resume=true]
 * @param {object} [input.engine]
 */
async function ingestAndResume(input) {
  var i = input || {}
  if (!i.provider) throw new Error('ingestAndResume: provider required')
  if (!i.eventName) throw new Error('ingestAndResume: eventName required')

  var engine = i.engine || createWorkflowEngine()
  var normalized = normalizeWebhookBody(i.body, {
    jobId: i.jobId,
    runId: i.runId,
    companyId: i.companyId,
    externalId: i.externalId,
    deliveryId: i.deliveryId,
    eventType: i.eventType,
  })

  var jobId = await resolveJobId(engine, normalized)
  var runId = normalized.runId

  // If runId provided, pull job/company from run
  var explicitRun = null
  if (runId) {
    explicitRun = await engine.state.getRun(runId)
    if (explicitRun) {
      jobId = jobId || explicitRun.job_id
      if (!normalized.companyId) normalized.companyId = explicitRun.company_id
    }
  }

  var event = await engine.events.ingestWebhook({
    provider: i.provider,
    eventName: i.eventName,
    eventType: normalized.eventType || i.eventType || i.eventName,
    runId: runId,
    jobId: jobId,
    companyId: normalized.companyId || i.companyId || null,
    externalId: normalized.externalId || normalized.transactionId || normalized.packageId,
    deliveryId: normalized.deliveryId,
    payload: Object.assign({}, asPlainObject(i.body), {
      normalized: {
        jobId: jobId,
        runId: runId,
        transactionId: normalized.transactionId,
        packageId: normalized.packageId,
        recordingNumber: normalized.recordingNumber,
      },
      provider: i.provider,
    }),
  })

  var resumed = []
  var skipped = []

  if (i.resume === false) {
    return {
      accepted: true,
      event: event,
      jobId: jobId,
      runId: runId,
      resumed: resumed,
      skipped: skipped,
      message: 'Event stored; resume skipped',
    }
  }

  var waiting = []
  if (explicitRun) {
    if (
      explicitRun.status === RUN_STATUS.WAITING ||
      explicitRun.status === RUN_STATUS.PAUSED
    ) {
      waiting = [explicitRun]
    } else {
      skipped.push({
        runId: explicitRun.id,
        reason: 'run_not_waiting',
        status: explicitRun.status,
      })
    }
  } else if (jobId) {
    waiting = await engine.state.findWaitingRuns({
      jobId: jobId,
      eventName: i.eventName,
      limit: 10,
    })

    // Fallback: waiting runs for job without resume_token match (older rows)
    if (!waiting.length) {
      var byJob = await engine.state.findWaitingRuns({
        jobId: jobId,
        limit: 10,
      })
      var hints = EVENT_TO_WORKFLOW_HINTS[i.eventName] || null
      waiting = byJob.filter(function (run) {
        if (!hints) return true
        return hints.indexOf(run.workflow_key) >= 0
      })
    }
  }

  for (var idx = 0; idx < waiting.length; idx++) {
    var run = waiting[idx]
    try {
      // Attach run_id on event when correlated after the fact
      if (!event.run_id && run.id) {
        await engine.state.supabase
          .from('workflow_events')
          .update({ run_id: run.id })
          .eq('id', event.id)
      }

      var updated = await resumeRun(engine, run, {
        eventName: i.eventName,
        stepOutput: {
          webhookEventId: event.id,
          provider: i.provider,
          eventName: i.eventName,
        },
        useLegacyBridge: i.useLegacyBridge,
        dryRun: i.dryRun,
      })

      await engine.events.markEventProcessed(event.id).catch(function () {})

      resumed.push({
        runId: run.id,
        workflowKey: run.workflow_key,
        status: updated && updated.status ? updated.status : null,
      })
    } catch (err) {
      skipped.push({
        runId: run.id,
        reason: err.message,
      })
    }
  }

  return {
    accepted: true,
    event: event,
    jobId: jobId,
    runId: runId,
    resumed: resumed,
    skipped: skipped,
    matchedWaiting: waiting.length,
  }
}

/**
 * HTTP helper: authorize + parse JSON + ingest.
 */
async function handleWebhookHttp(request, config) {
  var cfg = config || {}
  var auth = authorizeWebhook(request.headers, {
    providerSecretEnv: cfg.providerSecretEnv,
  })
  if (!auth.ok) {
    return {
      status: auth.status || 401,
      body: { error: auth.error || 'Unauthorized' },
    }
  }

  var body = {}
  try {
    body = await request.json()
  } catch (e) {
    body = {}
  }

  if (cfg.requireBodyFields && cfg.requireBodyFields.length) {
    var normalized = normalizeWebhookBody(body)
    for (var i = 0; i < cfg.requireBodyFields.length; i++) {
      var field = cfg.requireBodyFields[i]
      if (!normalized[field] && !body[field]) {
        return {
          status: 400,
          body: {
            error: 'Missing required field for correlation: ' + field +
              ' (or job_id / run_id / transaction_id / package_id)',
          },
        }
      }
    }
  }

  try {
    var result = await ingestAndResume({
      provider: cfg.provider,
      eventName: cfg.eventName,
      eventType: cfg.eventType,
      body: body,
      resume: cfg.resume !== false,
      useLegacyBridge: cfg.useLegacyBridge,
      dryRun: cfg.dryRun,
      jobId: cfg.jobId,
      runId: cfg.runId,
    })

    return {
      status: 200,
      body: Object.assign({ success: true, authVia: auth.via }, result, {
        warning: auth.warning || null,
      }),
    }
  } catch (err) {
    return {
      status: 500,
      body: { error: err.message || 'Webhook intake failed' },
    }
  }
}

module.exports = {
  EVENT_NAMES: EVENT_NAMES,
  normalizeWebhookBody: normalizeWebhookBody,
  ingestAndResume: ingestAndResume,
  handleWebhookHttp: handleWebhookHttp,
  authorizeWebhook: authorizeWebhook,
}
