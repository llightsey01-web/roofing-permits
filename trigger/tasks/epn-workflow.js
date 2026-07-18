import { task } from '@trigger.dev/sdk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Phase 1 — durable ePN recording orchestration (control plane).
 * Browser work is dispatched to Railway via automation_runs bridge.
 */
export const epnWorkflowTask = task({
  id: 'epn-workflow',
  retry: { maxAttempts: 3 },
  maxDuration: 60 * 60,
  run: async (payload) => {
    const { startEpnWorkflow } = require('../../workflows/epn-workflow.js')
    const result = await startEpnWorkflow({
      jobId: payload.jobId || payload.job_id,
      companyId: payload.companyId || payload.company_id || null,
      source: payload.source || 'trigger',
      useLegacyBridge: payload.useLegacyBridge !== false,
      dryRun: Boolean(payload.dryRun),
      triggerRunId: payload.triggerRunId || null,
      input: payload.input || {},
      createdBy: payload.createdBy || null,
      autoRun: payload.autoRun !== false,
    })
    return {
      runId: result.run && result.run.id,
      status: result.run && result.run.status,
      workflowKey: 'epn',
    }
  },
})

export const epnWorkflowResumeTask = task({
  id: 'epn-workflow-resume',
  retry: { maxAttempts: 3 },
  maxDuration: 60 * 60,
  run: async (payload) => {
    const { resumeEpnWorkflow } = require('../../workflows/epn-workflow.js')
    if (!payload.runId) throw new Error('epn-workflow-resume: runId required')
    const run = await resumeEpnWorkflow(payload.runId, {
      reason: payload.reason || 'trigger resume',
      source: payload.source || 'trigger',
      completeCurrentStep: payload.completeCurrentStep !== false,
      useLegacyBridge: payload.useLegacyBridge !== false,
      dryRun: Boolean(payload.dryRun),
      stepOutput: payload.stepOutput || {},
      fromFailed: Boolean(payload.fromFailed),
    })
    return {
      runId: run && run.id,
      status: run && run.status,
      workflowKey: 'epn',
    }
  },
})
