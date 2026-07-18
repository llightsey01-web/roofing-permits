'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

function startNotaryStep() {
  return createStep({
    key: 'start_notary',
    name: 'Start Notarization',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 6,
    maxAttempts: 3,
    handler: async function ({ run, logger, events }) {
      await logger.info('Starting notarization flow')
      await events.emitEvent({
        eventName: EVENT_NAMES.NOTARY_STARTED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { startedAt: new Date().toISOString() },
      })
      return { output: { notaryStarted: true } }
    },
  })
}

function waitForNotaryStep() {
  return createStep({
    key: 'wait_notary',
    name: 'Wait for Notarization',
    type: STEP_TYPE.WEBHOOK_WAIT,
    waitForEvent: EVENT_NAMES.NOTARY_COMPLETED,
    sequenceOrder: 7,
    maxAttempts: 1,
    timeoutMs: 14 * 24 * 60 * 60 * 1000,
  })
}

module.exports = {
  startNotaryStep: startNotaryStep,
  waitForNotaryStep: waitForNotaryStep,
}
