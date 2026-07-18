import { task } from '@trigger.dev/sdk'

/** Phase 4 stub — notifications migration not enabled yet. */
export const notificationWorkflowTask = task({
  id: 'notification-workflow',
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: async (payload) => {
    return {
      status: 'not_migrated',
      phase: 4,
      message: 'Notification durable workflow stub — enable WORKFLOW_ENGINE_NOTIFICATIONS when ready',
      payload: payload || {},
    }
  },
})
