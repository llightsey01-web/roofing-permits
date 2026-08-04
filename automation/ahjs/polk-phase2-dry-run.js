'use strict'

/**
 * Offline-only validation for Polk Phase 2.
 * This script does not launch a browser, load session state, or make network calls.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const config = require('./configs/polk-county.config.js')
const {
  validatePolkRunContract,
  resolvePolkPhase2Values,
  isPaymentBoundaryState,
} = require('./polk-county.runner.js')

const REQUIRED_SELECTOR_KEYS = [
  'myRecordsUrl',
  'resultGrid',
  'resumePageFlowModal',
  'gateCode',
  'gateAccessYes',
  'gateAccessNo',
  'codeViolationYes',
  'codeViolationNo',
  'codeViolationCaseNumber',
  'applicantOwnerYes',
  'applicantOwnerNo',
  'virtualInspectionYes',
  'virtualInspectionNo',
  'privateProviderYes',
  'privateProviderNo',
  'packetSubmission',
  'fs119Status',
  'workType',
  'propertyType',
  'reroofPermitType',
  'numberOfSquares',
  'roofType',
  'reroofAffidavit',
  'asbestosStatement',
  'commercialFranchiseHolderName',
  'commercialFranchiseHolderPhone',
  'disposalEquipment',
  'disposalFrequency',
  'jobDescription',
  'jobValue',
  'planUploadAcknowledgement',
  'continueBtn',
]

function expectThrow(fn, errorCode) {
  var caught = null
  try {
    fn()
  } catch (err) {
    caught = err
  }
  assert(caught, 'Expected function to throw')
  assert.strictEqual(caught.errorCode, errorCode)
}

function collectIds(value, ids) {
  if (!value || typeof value !== 'object') return
  if (typeof value.id === 'string' && value.id) ids.add(value.id)
  Object.keys(value).forEach(function(key) {
    collectIds(value[key], ids)
  })
}

function validateCapturedSelectorIds() {
  var fixturePath = path.join(__dirname, '..', '..', 'tmp', 'polk-selector-confirmation', 'selector-confirmation.json')
  if (!fs.existsSync(fixturePath)) {
    return { checked: false, reason: 'local selector-confirmation JSON not present' }
  }

  var fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  var ids = new Set()
  collectIds(fixture, ids)
  var domSelectorKeys = REQUIRED_SELECTOR_KEYS.filter(function(key) {
    var selector = config.selectors[key]
    return typeof selector === 'string' && /^#[A-Za-z0-9_-]+$/.test(selector)
  }).filter(function(key) {
    return key !== 'resumePageFlowModal'
  })
  var missing = domSelectorKeys.filter(function(key) {
    return !ids.has(config.selectors[key].slice(1))
  })
  assert.deepStrictEqual(missing, [], 'Captured selector JSON is missing: ' + missing.join(', '))
  return { checked: true, selectorCount: domSelectorKeys.length }
}

function main() {
  expectThrow(function() {
    validatePolkRunContract('permit_submit', {})
  }, 'unsupported_run_type')
  expectThrow(function() {
    validatePolkRunContract('permit_resume', {})
  }, 'missing_portal_record_number')

  var contract = validatePolkRunContract('permit_resume', { portal_record_number: 'TEST-DRAFT-1' })
  assert.strictEqual(contract.portalRecordNumber, 'TEST-DRAFT-1')

  REQUIRED_SELECTOR_KEYS.forEach(function(key) {
    assert.strictEqual(typeof config.selectors[key], 'string', 'Missing selector: ' + key)
    assert(config.selectors[key].trim(), 'Empty selector: ' + key)
  })

  var baseJob = {
    work_type: 'Repair',
    roof_type: 'Metal',
    scope_of_work: 'Offline validation only',
    valuation: 12500,
    job_specs: { squares: 24, portal_overrides: {} },
  }
  var defaults = resolvePolkPhase2Values(baseJob, config)
  assert.strictEqual(defaults.gateCodeRequired, false)
  assert.strictEqual(defaults.codeViolation, false)
  assert.strictEqual(defaults.fs119Status, 'Non-Exempt')
  assert.strictEqual(defaults.reroofPermitType, 'Reroof')
  assert.strictEqual(defaults.virtualInspections, false)
  assert.strictEqual(defaults.privateProvider, false)
  assert.strictEqual(defaults.packetSubmission, 'Electronically')

  var overrideJob = Object.assign({}, baseJob, {
    job_specs: {
      squares: 24,
      portal_overrides: {
        gate_code_required: true,
        gate_code: '2468',
        code_violation: true,
        code_violation_case_number: 'CASE-1',
        fs119_status: 'Exempt',
        reroof_permit_type: 'Roof Cover 3 inches or Less',
      },
    },
  })
  var overrides = resolvePolkPhase2Values(overrideJob, config)
  assert.strictEqual(overrides.gateCodeRequired, true)
  assert.strictEqual(overrides.gateCode, '2468')
  assert.strictEqual(overrides.codeViolation, true)
  assert.strictEqual(overrides.codeViolationCaseNumber, 'CASE-1')
  assert.strictEqual(overrides.fs119Status, 'Exempt')
  assert.strictEqual(overrides.reroofPermitType, 'Roof Cover 3 inches or Less')
  assert.strictEqual(overrides.privateProvider, false)

  assert.strictEqual(isPaymentBoundaryState('https://example.test/Cap/CapEdit.aspx', 'Step 4: Review'), false)
  assert.strictEqual(isPaymentBoundaryState('https://example.test/ShoppingCart/ShoppingCart.aspx', ''), true)
  assert.strictEqual(isPaymentBoundaryState('https://example.test/Cap/CapEdit.aspx', 'Step 5: Pay Fees'), true)

  var captured = validateCapturedSelectorIds()
  console.log(JSON.stringify({
    ok: true,
    configVersion: config.version,
    requiredSelectors: REQUIRED_SELECTOR_KEYS.length,
    capturedSelectorCrossCheck: captured,
    networkUsed: false,
  }, null, 2))
}

main()
