import { task } from '@trigger.dev/sdk'

/** Phase 3 stub — county submission migration not enabled yet. */
export const countySubmissionWorkflowTask = task({
  id: 'county-submission-workflow',
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: async (payload) => {
    return {
      status: 'not_migrated',
      phase: 3,
      message: 'County submission durable workflow stub — enable WORKFLOW_ENGINE_COUNTY when ready',
      payload: payload || {},
    }
  },
})
