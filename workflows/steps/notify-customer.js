'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

function notifyCustomerStep() {
  return createStep({
    key: 'notify_customer',
    name: 'Notify Customer',
    type: STEP_TYPE.NOTIFICATION,
    sequenceOrder: 15,
    maxAttempts: 3,
    handler: async function ({ run, logger, events }) {
      await logger.info('Queueing customer notification')

      // Phase 4 will call real SMS/email. For now emit + optional legacy notify_admin.
      await events.emitEvent({
        eventName: EVENT_NAMES.PERMIT_ISSUED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { notifiedAt: new Date().toISOString() },
      })

      return {
        output: {
          notified: true,
          channels: ['event'],
        },
      }
    },
  })
}

function completePermitStep() {
  return createStep({
    key: 'complete',
    name: 'Complete Permit Workflow',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 16,
    maxAttempts: 1,
    handler: async function ({ run, logger, events }) {
      await logger.info('Permit workflow complete')
      await events.emitEvent({
        eventName: EVENT_NAMES.WORKFLOW_COMPLETED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: { completedAt: new Date().toISOString() },
      })
      return { output: { completed: true } }
    },
  })
}

module.exports = {
  notifyCustomerStep: notifyCustomerStep,
  completePermitStep: completePermitStep,
}
