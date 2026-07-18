import { task, wait } from '@trigger.dev/sdk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/**
 * Poll Supabase until a workflow_activity / automation_run completes.
 * Prefer durable webhook/resume for long waits; this is a bounded helper.
 */
export const waitForActivity = task({
  id: 'wait-for-activity',
  retry: { maxAttempts: 2 },
  maxDuration: 60 * 60,
  run: async (payload) => {
    const { createWorkflowEngine } = require('../../../lib/workflow')
    const engine = createWorkflowEngine()
    const supabase = engine.state.supabase

    const activityId = payload.workflowActivityId || payload.activityId
    const legacyRunId = payload.legacyRunId
    const timeoutMs = payload.timeoutMs != null ? payload.timeoutMs : 45 * 60 * 1000
    const pollMs = payload.pollMs != null ? payload.pollMs : 15000
    const started = Date.now()

    while (Date.now() - started < timeoutMs) {
      if (activityId) {
        const { data: activity } = await supabase
          .from('workflow_activities')
          .select('id, status, error_message, result')
          .eq('id', activityId)
          .maybeSingle()
        if (activity && (activity.status === 'succeeded' || activity.status === 'failed')) {
          return {
            done: true,
            source: 'workflow_activity',
            status: activity.status,
            error: activity.error_message || null,
            result: activity.result || null,
          }
        }
      }

      if (legacyRunId) {
        const { data: legacy } = await supabase
          .from('automation_runs')
          .select('id, run_status, error_message')
          .eq('id', legacyRunId)
          .maybeSingle()
        if (legacy && (legacy.run_status === 'complete' || legacy.run_status === 'error' || legacy.run_status === 'needs_review')) {
          return {
            done: true,
            source: 'automation_runs',
            status: legacy.run_status,
            error: legacy.error_message || null,
          }
        }
      }

      await wait.for({ seconds: Math.max(1, Math.floor(pollMs / 1000)) })
    }

    throw Object.assign(new Error('wait-for-activity timed out'), {
      code: 'ACTIVITY_WAIT_TIMEOUT',
      retryable: true,
    })
  },
})
