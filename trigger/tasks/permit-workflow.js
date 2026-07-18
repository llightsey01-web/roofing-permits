import { task } from '@trigger.dev/sdk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Full permit durable workflow orchestration (control plane).
 * Use useLegacyBridge:true to enqueue Railway Playwright activities.
 */
export const permitWorkflowTask = task({
  id: 'permit-workflow',
  retry: { maxAttempts: 3 },
  maxDuration: 24 * 60 * 60,
  run: async (payload) => {
    const { startPermitWorkflow } = require('../../workflows/permit-workflow.js')
    const result = await startPermitWorkflow({
      jobId: payload.jobId || payload.job_id,
      companyId: payload.companyId || payload.company_id || null,
      source: payload.source || 'trigger',
      useLegacyBridge: Boolean(payload.useLegacyBridge),
      dryRun: Boolean(payload.dryRun),
      triggerRunId: payload.triggerRunId || null,
      input: payload.input || {},
      createdBy: payload.createdBy || null,
      autoRun: payload.autoRun !== false,
    })
    return {
      runId: result.run && result.run.id,
      status: result.run && result.run.status,
      workflowKey: 'permit',
    }
  },
})

export const permitWorkflowResumeTask = task({
  id: 'permit-workflow-resume',
  retry: { maxAttempts: 3 },
  maxDuration: 24 * 60 * 60,
  run: async (payload) => {
    const { resumePermitWorkflow } = require('../../workflows/permit-workflow.js')
    if (!payload.runId) throw new Error('permit-workflow-resume: runId required')
    const run = await resumePermitWorkflow(payload.runId, {
      reason: payload.reason || 'trigger resume',
      source: payload.source || 'trigger',
      completeCurrentStep: payload.completeCurrentStep !== false,
      useLegacyBridge: Boolean(payload.useLegacyBridge),
      dryRun: Boolean(payload.dryRun),
      stepOutput: payload.stepOutput || {},
      fromFailed: Boolean(payload.fromFailed),
    })
    return {
      runId: run && run.id,
      status: run && run.status,
      workflowKey: 'permit',
    }
  },
})
