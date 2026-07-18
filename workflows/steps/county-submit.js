'use strict'

var { createStep, STEP_TYPE, EVENT_NAMES } = require('../../lib/workflow')

function countyLoginStep() {
  return createStep({
    key: 'county_login',
    name: 'County Portal Login',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'permit_phase_1',
    sequenceOrder: 10,
    maxAttempts: 3,
    timeoutMs: 30 * 60 * 1000,
  })
}

function countyFillFormsStep() {
  return createStep({
    key: 'county_fill_forms',
    name: 'Fill County Forms',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'permit_resume',
    sequenceOrder: 11,
    maxAttempts: 3,
    timeoutMs: 45 * 60 * 1000,
  })
}

function countyUploadStep() {
  return createStep({
    key: 'county_upload',
    name: 'Upload Documents to County',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'permit_resume',
    sequenceOrder: 12,
    maxAttempts: 3,
    timeoutMs: 45 * 60 * 1000,
  })
}

function countySubmitStep() {
  return createStep({
    key: 'county_submit',
    name: 'Submit County Permit',
    type: STEP_TYPE.ACTIVITY,
    activityType: 'permit_submit',
    sequenceOrder: 13,
    maxAttempts: 3,
    timeoutMs: 45 * 60 * 1000,
  })
}

function waitForCountyStep() {
  return createStep({
    key: 'wait_county',
    name: 'Wait for County Confirmation',
    type: STEP_TYPE.WAIT,
    waitForEvent: EVENT_NAMES.COUNTY_SUBMISSION_COMPLETED,
    sequenceOrder: 14,
    maxAttempts: 1,
    timeoutMs: 30 * 24 * 60 * 60 * 1000,
  })
}

module.exports = {
  countyLoginStep: countyLoginStep,
  countyFillFormsStep: countyFillFormsStep,
  countyUploadStep: countyUploadStep,
  countySubmitStep: countySubmitStep,
  waitForCountyStep: waitForCountyStep,
}
