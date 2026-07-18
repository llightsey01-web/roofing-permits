'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

/**
 * Submit ePN recording — Phase 1 migration target (Railway erecord_submit).
 */
function submitEpnStep() {
  return createStep({
    key: 'submit_epn',
    name: 'Submit ePN',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'erecord_submit',
    sequenceOrder: 8,
    maxAttempts: 3,
    timeoutMs: 45 * 60 * 1000,
  })
}

function waitForRecordingStep() {
  return createStep({
    key: 'wait_recording',
    name: 'Wait for Recording',
    type: STEP_TYPE.WEBHOOK_WAIT,
    waitForEvent: EVENT_NAMES.RECORDING_FINISHED,
    sequenceOrder: 9,
    maxAttempts: 1,
    timeoutMs: 7 * 24 * 60 * 60 * 1000,
  })
}

function submitEpnDryRunStep() {
  return createStep({
    key: 'submit_epn',
    name: 'Submit ePN',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 8,
    handler: async function ({ run, logger, events }) {
      await logger.info('ePN submit dry-run')
      await events.emitEvent({
        eventName: EVENT_NAMES.RECORDING_STARTED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { dryRun: true },
      })
      return { output: { dryRun: true, submitted: true } }
    },
  })
}

module.exports = {
  submitEpnStep: submitEpnStep,
  waitForRecordingStep: waitForRecordingStep,
  submitEpnDryRunStep: submitEpnDryRunStep,
}
