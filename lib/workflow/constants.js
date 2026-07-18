'use strict'

/** Workflow run statuses (must match DB CHECK) */
const RUN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  WAITING: 'waiting',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  COMPENSATING: 'compensating',
}

/** Step statuses */
const STEP_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  PAUSED: 'paused',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
  COMPENSATED: 'compensated',
}

/** Step types */
const STEP_TYPE = {
  ACTION: 'action',
  WAIT: 'wait',
  ACTIVITY: 'activity',
  WEBHOOK_WAIT: 'webhook_wait',
  HUMAN_GATE: 'human_gate',
  COMPENSATION: 'compensation',
  NOTIFICATION: 'notification',
}

/** Activity statuses for Railway browser bridge */
const ACTIVITY_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

/** Durable domain event names */
const EVENT_NAMES = {
  PERMIT_CREATED: 'PermitCreated',
  DOCUMENTS_EXTRACTED: 'DocumentsExtracted',
  DOCUMENTS_VALIDATED: 'DocumentsValidated',
  NOC_GENERATED: 'NOCGenerated',
  SIGNATURE_REQUESTED: 'SignatureRequested',
  SIGNATURE_COMPLETED: 'SignatureCompleted',
  NOTARY_STARTED: 'NotaryStarted',
  NOTARY_COMPLETED: 'NotaryCompleted',
  RECORDING_STARTED: 'RecordingStarted',
  RECORDING_FINISHED: 'RecordingFinished',
  COUNTY_SUBMISSION_STARTED: 'CountySubmissionStarted',
  COUNTY_SUBMISSION_COMPLETED: 'CountySubmissionCompleted',
  PERMIT_ISSUED: 'PermitIssued',
  INSPECTION_SCHEDULED: 'InspectionScheduled',
  WORKFLOW_PAUSED: 'WorkflowPaused',
  WORKFLOW_RESUMED: 'WorkflowResumed',
  WORKFLOW_FAILED: 'WorkflowFailed',
  WORKFLOW_COMPLETED: 'WorkflowCompleted',
  WORKFLOW_CANCELLED: 'WorkflowCancelled',
  ACTIVITY_COMPLETED: 'ActivityCompleted',
  ACTIVITY_FAILED: 'ActivityFailed',
  ERECORD_PREPARE_COMPLETED: 'ErecordPrepareCompleted',
  ERECORD_REVIEW_APPROVED: 'ErecordReviewApproved',
  ERECORD_SUBMITTED: 'ErecordSubmitted',
}

const PAUSE_REASONS = {
  SIGNATURE: 'signature',
  NOTARY: 'notary',
  COUNTY: 'county',
  PAYMENT: 'payment',
  RECORDING: 'recording',
  MANUAL: 'manual',
  CONTRACTOR_APPROVAL: 'contractor_approval',
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000

module.exports = {
  RUN_STATUS: RUN_STATUS,
  STEP_STATUS: STEP_STATUS,
  STEP_TYPE: STEP_TYPE,
  ACTIVITY_STATUS: ACTIVITY_STATUS,
  EVENT_NAMES: EVENT_NAMES,
  PAUSE_REASONS: PAUSE_REASONS,
  DEFAULT_MAX_ATTEMPTS: DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS: DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS: DEFAULT_MAX_DELAY_MS,
}
