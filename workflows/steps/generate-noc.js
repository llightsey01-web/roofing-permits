'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

/**
 * Generate NOC — activity dispatched to Railway noc_generate worker when bridged.
 */
function generateNocStep() {
  return createStep({
    key: 'generate_noc',
    name: 'Generate NOC',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'noc_generate',
    sequenceOrder: 3,
    maxAttempts: 3,
    timeoutMs: 30 * 60 * 1000,
    handler: null,
  })
}

/**
 * Local/dev action variant that records intent without Playwright.
 * Used when context.dryRun === true.
 */
function generateNocDryRunStep() {
  return createStep({
    key: 'generate_noc',
    name: 'Generate NOC',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 3,
    maxAttempts: 1,
    handler: async function ({ run, logger, events, artifacts }) {
      await logger.info('NOC generate dry-run (no Playwright)')
      var output = {
        dryRun: true,
        nocStatus: 'generated_stub',
        generatedAt: new Date().toISOString(),
      }
      await artifacts.recordArtifact({
        runId: run.id,
        artifactType: 'other',
        name: 'noc-generate-dry-run',
        metadata: output,
      })
      await events.emitEvent({
        eventName: EVENT_NAMES.NOC_GENERATED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: output,
      })
      return { output: output }
    },
  })
}

module.exports = {
  generateNocStep: generateNocStep,
  generateNocDryRunStep: generateNocDryRunStep,
}
