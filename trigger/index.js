/**
 * Trigger.dev task registration barrel.
 * Individual task files under ./tasks are also discovered via trigger.config.js dirs.
 */

export { epnWorkflowTask, epnWorkflowResumeTask } from './tasks/epn-workflow.js'
export { permitWorkflowTask, permitWorkflowResumeTask } from './tasks/permit-workflow.js'
export { notaryWorkflowTask } from './tasks/notary-workflow.js'
export { countySubmissionWorkflowTask } from './tasks/county-submission-workflow.js'
export { notificationWorkflowTask } from './tasks/notification-workflow.js'
export { aiExtractionWorkflowTask } from './tasks/ai-extraction-workflow.js'
export { dispatchPlaywrightActivity } from './tasks/activities/dispatch-playwright.js'
export { waitForActivity } from './tasks/activities/wait-for-activity.js'
export {
  generateNocActivity,
  requestSignatureActivity,
  startNotaryActivity,
  submitEpnActivity,
  notifyCustomerActivity,
  recordArtifactActivity,
} from './tasks/activities/generate-noc.js'
