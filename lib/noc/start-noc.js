// lib/noc/start-noc.js
// Shared NOC phase entry — used by automation after parcel save (includes downstream chain)

const { runNocPhaseForJob } = require('./run-noc-phase.js')
const { continueAfterNocGenerated } = require('../automation/noc-after-noc-core.js')

async function startNocPhaseForJob(jobId, options) {
  const phase = await runNocPhaseForJob(jobId, options)
  const chainResult = await continueAfterNocGenerated(jobId, options)

  return {
    success: true,
    jobId: phase.jobId,
    status: phase.status,
    nocStatus: phase.nocStatus,
    nocFilePath: phase.nocFilePath,
    pipeline: phase.pipeline,
    chain: chainResult,
  }
}

module.exports = {
  startNocPhaseForJob,
}
