import { task } from '@trigger.dev/sdk'

/** Phase 2 stub — notary migration not enabled yet. */
export const notaryWorkflowTask = task({
  id: 'notary-workflow',
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: async (payload) => {
    return {
      status: 'not_migrated',
      phase: 2,
      message: 'Notary durable workflow stub — enable WORKFLOW_ENGINE_NOTARY when ready',
      payload: payload || {},
    }
  },
})
