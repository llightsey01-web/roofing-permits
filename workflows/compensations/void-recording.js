'use strict'

/**
 * Compensation for ePN / recording side effects.
 * Phase 1 will call provider void APIs when available.
 */
async function voidRecordingCompensation(ctx) {
  var logger = ctx.logger
  await logger.warn('Compensation: void recording (stub)', {
    runId: ctx.run && ctx.run.id,
    stepKey: ctx.step && ctx.step.step_key,
  })
  return {
    compensated: true,
    action: 'void_recording_stub',
    note: 'No provider void executed — implement in Phase 1 ePN migration',
  }
}

module.exports = {
  voidRecordingCompensation: voidRecordingCompensation,
}
