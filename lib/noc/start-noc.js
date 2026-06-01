// lib/noc/start-noc.js
// Shared NOC phase entry — used by automation after parcel save (includes downstream chain)

import { runNocPhaseForJob } from './run-noc-phase.js'

export async function startNocPhaseForJob(jobId, options) {
  const phase = await runNocPhaseForJob(jobId, options)
  const chainMod = await import('../automation/noc-after-noc-core.js')
  const continueAfterNocGenerated =
    chainMod.continueAfterNocGenerated || chainMod.default.continueAfterNocGenerated
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
