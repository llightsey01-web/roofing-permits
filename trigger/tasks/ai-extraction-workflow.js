import { task } from '@trigger.dev/sdk'

/** Phase 5 stub — AI extraction migration not enabled yet. */
export const aiExtractionWorkflowTask = task({
  id: 'ai-extraction-workflow',
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: async (payload) => {
    return {
      status: 'not_migrated',
      phase: 5,
      message: 'AI extraction durable workflow stub — enable WORKFLOW_ENGINE_AI_EXTRACTION when ready',
      payload: payload || {},
    }
  },
})
