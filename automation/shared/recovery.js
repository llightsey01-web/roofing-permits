// automation/shared/recovery.js
// Run recovery helpers
const { getCheckpoint } = require('./checkpoint.js')

async function getResumePoint(runId) {
  const checkpoint = await getCheckpoint(runId)
  if (!checkpoint || !checkpoint.last_completed_step_number) {
    return { stepNumber: 0, stepName: null, isResume: false }
  }
  return {
    stepNumber: checkpoint.last_completed_step_number,
    stepName: checkpoint.last_completed_step,
    checkpointData: checkpoint.checkpoint_data || {},
    isResume: true,
  }
}

async function logRecoveryStart(runId) {
  const resume = await getResumePoint(runId)
  if (resume.isResume) {
    console.log('[recovery] Resuming from step ' + resume.stepNumber + ' — ' + resume.stepName)
  } else {
    console.log('[recovery] Starting fresh run')
  }
  return resume
}

module.exports = { getResumePoint, logRecoveryStart }
