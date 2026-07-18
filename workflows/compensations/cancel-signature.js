'use strict'

/**
 * Compensation for signature request side effects.
 * Phase 2 will cancel open Proof transactions when supported.
 */
async function cancelSignatureCompensation(ctx) {
  var logger = ctx.logger
  await logger.warn('Compensation: cancel signature (stub)', {
    runId: ctx.run && ctx.run.id,
    stepKey: ctx.step && ctx.step.step_key,
  })
  return {
    compensated: true,
    action: 'cancel_signature_stub',
    note: 'No Proof cancel executed — implement in Phase 2 notary/signature migration',
  }
}

module.exports = {
  cancelSignatureCompensation: cancelSignatureCompensation,
}
