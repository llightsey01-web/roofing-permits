'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

/**
 * Validate extracted documents / required permit packet fields.
 */
function validateDocumentsStep() {
  return createStep({
    key: 'validate_documents',
    name: 'Validate Documents',
    type: STEP_TYPE.ACTION,
    sequenceOrder: 2,
    maxAttempts: 2,
    handler: async function ({ run, input, logger, events }) {
      await logger.info('Validating permit documents')

      var required = ['propertyAddress', 'ownerName']
      var fields = (input && input.extractedFields) || (input && input.fields) || {}
      var missing = required.filter(function (k) {
        return !fields[k] && !(input && input[k])
      })

      // Soft validation in Phase 0 — hard fail only when enforceValidation is set
      if (missing.length && input && input.enforceValidation) {
        var err = new Error('Missing required fields: ' + missing.join(', '))
        err.code = 'VALIDATION_FAILED'
        err.retryable = false
        err.failureType = 'validation'
        throw err
      }

      var result = {
        valid: missing.length === 0,
        missing: missing,
        validatedAt: new Date().toISOString(),
      }

      await events.emitEvent({
        eventName: EVENT_NAMES.DOCUMENTS_VALIDATED,
        runId: run.id,
        jobId: run.job_id,
        companyId: run.company_id,
        source: 'system',
        payload: result,
      })

      return { output: result }
    },
  })
}

module.exports = { validateDocumentsStep: validateDocumentsStep }
