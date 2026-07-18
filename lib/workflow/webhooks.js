'use strict'

/**
 * Typed durable webhook handlers for Proof, ePN, and county callbacks.
 */

var { EVENT_NAMES } = require('./constants.js')
var intake = require('./webhook-intake.js')

async function handleProofSignature(request, options) {
  var o = options || {}
  return intake.handleWebhookHttp(request, {
    provider: 'proof',
    eventName: EVENT_NAMES.SIGNATURE_COMPLETED,
    eventType: 'signature.completed',
    providerSecretEnv: 'PROOF_WEBHOOK_SECRET',
    resume: o.resume !== false,
    useLegacyBridge: o.useLegacyBridge,
    dryRun: o.dryRun,
  })
}

async function handleProofNotarization(request, options) {
  var o = options || {}
  return intake.handleWebhookHttp(request, {
    provider: 'proof',
    eventName: EVENT_NAMES.NOTARY_COMPLETED,
    eventType: 'notarization.completed',
    providerSecretEnv: 'PROOF_WEBHOOK_SECRET',
    resume: o.resume !== false,
    useLegacyBridge: o.useLegacyBridge,
    dryRun: o.dryRun,
  })
}

async function handleEpnRecording(request, options) {
  var o = options || {}
  return intake.handleWebhookHttp(request, {
    provider: 'epn',
    eventName: EVENT_NAMES.RECORDING_FINISHED,
    eventType: 'recording.finished',
    providerSecretEnv: 'EPN_WEBHOOK_SECRET',
    resume: o.resume !== false,
    useLegacyBridge: o.useLegacyBridge !== false,
    dryRun: o.dryRun,
  })
}

async function handleCountyCallback(request, options) {
  var o = options || {}
  return intake.handleWebhookHttp(request, {
    provider: 'county',
    eventName: EVENT_NAMES.COUNTY_SUBMISSION_COMPLETED,
    eventType: 'county.submission.completed',
    providerSecretEnv: 'COUNTY_WEBHOOK_SECRET',
    resume: o.resume !== false,
    useLegacyBridge: o.useLegacyBridge,
    dryRun: o.dryRun,
  })
}

/**
 * Internal notify helpers (workers / completion paths — no HTTP).
 */
async function notifySignatureCompleted(input) {
  return intake.ingestAndResume(
    Object.assign({}, input || {}, {
      provider: 'proof',
      eventName: EVENT_NAMES.SIGNATURE_COMPLETED,
      eventType: 'signature.completed',
    })
  )
}

async function notifyNotaryCompleted(input) {
  return intake.ingestAndResume(
    Object.assign({}, input || {}, {
      provider: 'proof',
      eventName: EVENT_NAMES.NOTARY_COMPLETED,
      eventType: 'notarization.completed',
    })
  )
}

async function notifyRecordingFinished(input) {
  return intake.ingestAndResume(
    Object.assign({}, input || {}, {
      provider: (input && input.provider) || 'epn',
      eventName: EVENT_NAMES.RECORDING_FINISHED,
      eventType: 'recording.finished',
      useLegacyBridge: input && input.useLegacyBridge !== false,
    })
  )
}

async function notifyCountySubmissionCompleted(input) {
  return intake.ingestAndResume(
    Object.assign({}, input || {}, {
      provider: 'county',
      eventName: EVENT_NAMES.COUNTY_SUBMISSION_COMPLETED,
      eventType: 'county.submission.completed',
    })
  )
}

module.exports = {
  handleProofSignature: handleProofSignature,
  handleProofNotarization: handleProofNotarization,
  handleEpnRecording: handleEpnRecording,
  handleCountyCallback: handleCountyCallback,
  notifySignatureCompleted: notifySignatureCompleted,
  notifyNotaryCompleted: notifyNotaryCompleted,
  notifyRecordingFinished: notifyRecordingFinished,
  notifyCountySubmissionCompleted: notifyCountySubmissionCompleted,
  ingestAndResume: intake.ingestAndResume,
  EVENT_NAMES: EVENT_NAMES,
}
