'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

/**
 * AI / OCR document extraction (Phase 5 will replace stub with real pipeline).
 */
function extractDocumentsStep() {
  return createStep({
    key: 'extract_documents',
    name: 'Extract Documents',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 1,
    maxAttempts: 3,
    handler: async function ({ run, input, logger, events, artifacts }) {
      await logger.info('Extracting permit documents')

      var extracted = {
        jobId: run.job_id,
        fields: (input && input.extractedFields) || {},
        source: 'workflow_stub',
        extractedAt: new Date().toISOString(),
      }

      await artifacts.recordArtifact({
        runId: run.id,
        artifactType: 'llm_output',
        name: 'document-extraction.json',
        metadata: extracted,
      })

      await events.emitEvent({
        eventName: EVENT_NAMES.DOCUMENTS_EXTRACTED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: extracted,
      })

      return { output: extracted }
    },
  })
}

module.exports = { extractDocumentsStep: extractDocumentsStep }
