import { task } from '@trigger.dev/sdk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Enqueue a Railway Playwright activity via automation_runs bridge.
 * Does NOT run Playwright in Trigger cloud.
 */
export const dispatchPlaywrightActivity = task({
  id: 'dispatch-playwright',
  retry: { maxAttempts: 3 },
  maxDuration: 120,
  run: async (payload) => {
    const { createWorkflowEngine, createWorkflowBridge } = require('../../../lib/workflow')
    const engine = createWorkflowEngine()
    const bridge = createWorkflowBridge({ state: engine.state })

    if (!payload.jobId || !payload.runType) {
      throw new Error('dispatch-playwright: jobId and runType required')
    }

    const legacy = await bridge.enqueueLegacyAutomationRun({
      jobId: payload.jobId,
      runType: payload.runType,
      workflowRunId: payload.workflowRunId || null,
      workflowStepId: payload.workflowStepId || null,
      workflowActivityId: payload.workflowActivityId || null,
      payload: Object.assign({}, payload.payload || {}, {
        source: 'trigger_dispatch_playwright',
        stepKey: payload.stepKey || null,
      }),
    })

    return {
      legacyRunId: legacy.id,
      runType: legacy.run_type,
      status: legacy.run_status,
    }
  },
})
