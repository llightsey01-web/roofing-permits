'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

/**
 * Request homeowner signature (Proof send) — Railway proof_send activity.
 */
function requestSignatureStep() {
  return createStep({
    key: 'request_signature',
    name: 'Request Signature',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'proof_send',
    sequenceOrder: 4,
    maxAttempts: 3,
    timeoutMs: 30 * 60 * 1000,
  })
}

/**
 * Pause until Proof signature webhook / SignatureCompleted event.
 */
function waitForSignatureStep() {
  return createStep({
    key: 'wait_signature',
    name: 'Wait for Signature',
    type: STEP_TYPE.WEBHOOK_WAIT,
    waitForEvent: EVENT_NAMES.SIGNATURE_COMPLETED,
    sequenceOrder: 5,
    maxAttempts: 1,
    timeoutMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  })
}

function requestSignatureDryRunStep() {
  return createStep({
    key: 'request_signature',
    name: 'Request Signature',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 4,
    handler: async function ({ run, logger, events }) {
      await logger.info('Signature request dry-run')
      await events.emitEvent({
        eventName: EVENT_NAMES.SIGNATURE_REQUESTED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { dryRun: true },
      })
      return { output: { dryRun: true, requested: true } }
    },
  })
}

module.exports = {
  requestSignatureStep: requestSignatureStep,
  waitForSignatureStep: waitForSignatureStep,
  requestSignatureDryRunStep: requestSignatureDryRunStep,
}
