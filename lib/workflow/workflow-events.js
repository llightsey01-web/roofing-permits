'use strict'

var constants = require('./constants.js')
var idempotency = require('./workflow-idempotency.js')
var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')

/**
 * Durable event system backed by workflow_events.
 * Trigger.dev waitForEvent will poll/subscribe against these rows in later phases.
 */
function createWorkflowEvents(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var logger = opts.logger || createWorkflowLogger({ state: state })

  /**
   * Emit a durable event. Idempotent on idempotency_key.
   */
  async function emitEvent(input) {
    var i = input || {}
    if (!i.eventName) throw new Error('emitEvent: eventName required')

    var idempotencyKey =
      i.idempotencyKey ||
      idempotency.eventKey({
        eventName: i.eventName,
        runId: i.runId,
        jobId: i.jobId,
        externalId: i.externalId,
        payloadHash: i.payloadHash,
      })

    var row = {
      run_id: i.runId || null,
      job_id: i.jobId || null,
      company_id: i.companyId || null,
      event_name: i.eventName,
      idempotency_key: idempotencyKey,
      source: i.source || 'system',
      payload: i.payload || {},
      processed_at: i.markProcessed ? new Date().toISOString() : null,
    }

    var { data, error } = await state.supabase
      .from('workflow_events')
      .upsert(row, { onConflict: 'idempotency_key' })
      .select('*')
      .single()

    if (error) throw new Error('emitEvent: ' + error.message)

    if (i.runId) {
      await logger.info('event emitted: ' + i.eventName, {
        eventId: data.id,
        source: row.source,
      }, { runId: i.runId })
    }

    return data
  }

  /**
   * Find the latest matching unprocessed (or any) event.
   */
  async function findEvent(input) {
    var i = input || {}
    if (!i.eventName) throw new Error('findEvent: eventName required')

    var query = state.supabase
      .from('workflow_events')
      .select('*')
      .eq('event_name', i.eventName)
      .order('created_at', { ascending: false })
      .limit(1)

    if (i.runId) query = query.eq('run_id', i.runId)
    if (i.jobId) query = query.eq('job_id', i.jobId)
    if (i.unprocessedOnly) query = query.is('processed_at', null)

    var { data, error } = await query.maybeSingle()
    if (error) throw new Error('findEvent: ' + error.message)
    return data
  }

  async function markEventProcessed(eventId) {
    var { data, error } = await state.supabase
      .from('workflow_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('*')
      .single()
    if (error) throw new Error('markEventProcessed: ' + error.message)
    return data
  }

  /**
   * Poll until an event appears or timeout.
   * Used by local/dev and as a fallback; Trigger.dev wait will replace busy-wait in cloud.
   */
  async function waitForEvent(input) {
    var i = input || {}
    var timeoutMs = i.timeoutMs != null ? i.timeoutMs : 60 * 60 * 1000
    var pollMs = i.pollMs != null ? i.pollMs : 5000
    var started = Date.now()

    while (Date.now() - started < timeoutMs) {
      var event = await findEvent({
        eventName: i.eventName,
        runId: i.runId,
        jobId: i.jobId,
        unprocessedOnly: i.unprocessedOnly !== false,
      })
      if (event) {
        if (i.markProcessed !== false) {
          await markEventProcessed(event.id)
        }
        return event
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, pollMs)
      })
    }

    var err = new Error(
      'waitForEvent timed out waiting for ' + i.eventName + ' after ' + timeoutMs + 'ms'
    )
    err.code = 'WAIT_TIMEOUT'
    err.retryable = true
    throw err
  }

  /**
   * Correlate a webhook delivery into a durable event + optional run resume token match.
   */
  async function ingestWebhook(input) {
    var i = input || {}
    var idempotencyKey =
      i.idempotencyKey ||
      idempotency.webhookEventKey({
        provider: i.provider,
        eventType: i.eventType || i.eventName,
        externalId: i.externalId,
        deliveryId: i.deliveryId,
      })

    return emitEvent({
      eventName: i.eventName,
      runId: i.runId,
      jobId: i.jobId,
      companyId: i.companyId,
      source: 'webhook',
      externalId: i.externalId || i.deliveryId,
      idempotencyKey: idempotencyKey,
      payload: Object.assign({}, i.payload || {}, {
        provider: i.provider || null,
        eventType: i.eventType || null,
      }),
    })
  }

  return {
    EVENT_NAMES: constants.EVENT_NAMES,
    emitEvent: emitEvent,
    emit: emitEvent,
    findEvent: findEvent,
    markEventProcessed: markEventProcessed,
    waitForEvent: waitForEvent,
    waitForWebhook: ingestWebhook,
    ingestWebhook: ingestWebhook,
  }
}

module.exports = {
  createWorkflowEvents: createWorkflowEvents,
  EVENT_NAMES: constants.EVENT_NAMES,
}
