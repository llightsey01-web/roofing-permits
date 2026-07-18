import { task } from '@trigger.dev/sdk'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/** Thin Trigger activity wrappers — real work stays in workflows/ + Railway. */
function makePassthrough(id, message) {
  return task({
    id: id,
    retry: { maxAttempts: 2 },
    maxDuration: 120,
    run: async (payload) => {
      return {
        status: 'delegated',
        message: message,
        payload: payload || {},
      }
    },
  })
}

export const generateNocActivity = makePassthrough(
  'activity-generate-noc',
  'Use permit/epn workflow activityType noc_generate on Railway'
)
export const requestSignatureActivity = makePassthrough(
  'activity-request-signature',
  'Use permit workflow activityType proof_send on Railway'
)
export const startNotaryActivity = makePassthrough(
  'activity-start-notary',
  'Notary step is wait/webhook driven; Playwright proof_check is on Railway'
)
export const submitEpnActivity = makePassthrough(
  'activity-submit-epn',
  'Use epn workflow activityType erecord_submit on Railway'
)
export const notifyCustomerActivity = makePassthrough(
  'activity-notify-customer',
  'Notification phase stub — enable WORKFLOW_ENGINE_NOTIFICATIONS later'
)

export const recordArtifactActivity = task({
  id: 'activity-record-artifact',
  retry: { maxAttempts: 3 },
  maxDuration: 60,
  run: async (payload) => {
    const { createWorkflowArtifacts } = require('../../../lib/workflow')
    const artifacts = createWorkflowArtifacts()
    if (!payload.runId || !payload.name) {
      throw new Error('activity-record-artifact: runId and name required')
    }
    const row = await artifacts.recordArtifact({
      runId: payload.runId,
      stepId: payload.stepId || null,
      artifactType: payload.artifactType || 'other',
      name: payload.name,
      storageBucket: payload.storageBucket || null,
      storagePath: payload.storagePath || null,
      contentType: payload.contentType || null,
      metadata: payload.metadata || {},
    })
    return { artifactId: row.id }
  },
})
