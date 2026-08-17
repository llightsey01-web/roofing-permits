// lib/automation/workflow-type-dispatch.js
// ZIG-8: type-first execution family selection (pure; no DB / Playwright).
// workflow_file remains portal-runner selection only — never used here.

'use strict'

var PORTAL_FAMILY = 'portal'
var PDF_PACKET_FAMILY = 'pdf_packet'
var UNSUPPORTED_FAMILY = 'unsupported'

/**
 * Map ahj_portals.workflow_type → execution family.
 * @param {string|null|undefined} workflowType
 * @returns {'portal'|'pdf_packet'|'unsupported'}
 */
function selectExecutionFamily(workflowType) {
  if (workflowType === 'portal') return PORTAL_FAMILY
  if (workflowType === 'pdf_packet') return PDF_PACKET_FAMILY
  // hybrid, email, unknown, missing → fail closed at type-first layer
  return UNSUPPORTED_FAMILY
}

/**
 * Terminal, non-retryable error for hybrid / email / unknown workflow types.
 * Consumed by lib/automation/retry.js (nonRetryable / errorCode).
 * @param {string|null|undefined} workflowType
 */
function unsupportedWorkflowTypeError(workflowType) {
  var label = workflowType == null || workflowType === '' ? '(missing)' : String(workflowType)
  return Object.assign(
    new Error('Unsupported AHJ workflow_type for permit execution: ' + label),
    { errorCode: 'unsupported_workflow_type', nonRetryable: true }
  )
}

/**
 * Type-first dispatch. Callers inject portal vs packet handlers so unit tests
 * can prove pdf_packet never invokes Playwright loaders.
 *
 * @param {object} ahj
 * @param {object} job
 * @param {object} runRecord
 * @param {string} runId
 * @param {object} handlers
 * @param {Function} handlers.runPortalWorkflowByFile — (ahj, job, runRecord, runId) => Promise
 * @param {Function} handlers.runPermitPacketSkeleton — (job, runRecord) => Promise
 */
async function dispatchByWorkflowType(ahj, job, runRecord, runId, handlers) {
  if (!handlers || typeof handlers.runPortalWorkflowByFile !== 'function') {
    throw new Error('dispatchByWorkflowType: handlers.runPortalWorkflowByFile is required')
  }
  if (typeof handlers.runPermitPacketSkeleton !== 'function') {
    throw new Error('dispatchByWorkflowType: handlers.runPermitPacketSkeleton is required')
  }

  var family = selectExecutionFamily(ahj && ahj.workflow_type)
  if (family === PDF_PACKET_FAMILY) {
    return handlers.runPermitPacketSkeleton(job, runRecord)
  }
  if (family === PORTAL_FAMILY) {
    return handlers.runPortalWorkflowByFile(ahj, job, runRecord, runId)
  }
  throw unsupportedWorkflowTypeError(ahj && ahj.workflow_type)
}

module.exports = {
  PORTAL_FAMILY: PORTAL_FAMILY,
  PDF_PACKET_FAMILY: PDF_PACKET_FAMILY,
  UNSUPPORTED_FAMILY: UNSUPPORTED_FAMILY,
  selectExecutionFamily: selectExecutionFamily,
  unsupportedWorkflowTypeError: unsupportedWorkflowTypeError,
  dispatchByWorkflowType: dispatchByWorkflowType,
}
