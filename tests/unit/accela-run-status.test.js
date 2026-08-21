// tests/unit/accela-run-status.test.js
// ZIG-13 PR 2: Accela proven-success run_status writers
'use strict'

const fs = require('fs')
const path = require('path')
const {
  RUN_STATUS_COMPLETE,
  RUN_STATUS_NEEDS_REVIEW,
  RUN_STATUS_ERROR,
} = require('../../lib/automation/run-status.js')

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8')
}

function assignedValue(src, name) {
  var match = src.match(new RegExp('var ' + name + ' = ([^\\n]+)'))
  expect(match).not.toBeNull()
  return match[1].replace(/;?\s*$/, '')
}

function sliceFunction(src, name) {
  var start = src.indexOf('async function ' + name)
  if (start < 0) start = src.indexOf('function ' + name)
  expect(start).toBeGreaterThan(-1)
  var brace = src.indexOf('{', start)
  var depth = 0
  for (var i = brace; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('Could not slice function ' + name)
}

var POLK_SRC = readRepoFile('automation/ahjs/polk-county.runner.js')
var LEE_SRC = readRepoFile('automation/ahjs/lee-county.runner.js')
var HILLSBOROUGH_SRC = readRepoFile('automation/ahjs/hillsborough-county.runner.js')
var PASCO_SRC = readRepoFile('automation/ahjs/pasco-county.runner.js')
var LAKE_SRC = readRepoFile('automation/ahjs/lake-county.runner.js')

describe('Accela run_status writers (ZIG-13 PR 2)', function () {
  test('shared runner uses canonical constants for Accela run outcomes', function () {
    expect(POLK_SRC).toMatch(/require\('\.\.\/\.\.\/lib\/automation\/run-status\.js'\)/)
    expect(assignedValue(POLK_SRC, 'RUN_STATUS_PHASE1_SUCCESS')).toBe('RUN_STATUS_COMPLETE')
    expect(assignedValue(POLK_SRC, 'RUN_STATUS_DOCUMENT_UPLOAD')).toBe('RUN_STATUS_COMPLETE')
    expect(assignedValue(POLK_SRC, 'RUN_STATUS_PHASE2_REVIEW')).toBe('RUN_STATUS_NEEDS_REVIEW')
    expect(assignedValue(POLK_SRC, 'RUN_STATUS_PHASE1_FAILURE')).toBe('RUN_STATUS_ERROR')
    expect(RUN_STATUS_COMPLETE).toBe('complete')
    expect(RUN_STATUS_NEEDS_REVIEW).toBe('needs_review')
    expect(RUN_STATUS_ERROR).toBe('error')
  })

  test('Phase 1 successful draft/save writes complete', function () {
    var successBlock = POLK_SRC.slice(
      POLK_SRC.indexOf('Portal draft saved'),
      POLK_SRC.indexOf('PHASE 1 COMPLETE — POST-PHASE 1 CHAIN')
    )
    expect(successBlock).toMatch(/run_status:\s*RUN_STATUS_PHASE1_SUCCESS/)
    expect(successBlock).toMatch(/Mark automation run complete after Phase 1 success/)
    expect(successBlock).not.toMatch(/run_status:\s*RUN_STATUS_NEEDS_REVIEW/)
    expect(successBlock).not.toMatch(/run_status:\s*'needs_review'/)
  })

  test('successful document-upload run writes complete and keeps job_status submitted', function () {
    var upload = sliceFunction(POLK_SRC, 'runPolkDocumentUpload')
    expect(upload).toMatch(/run_status:\s*RUN_STATUS_DOCUMENT_UPLOAD/)
    expect(upload).toMatch(/Mark document upload run complete/)
    expect(upload).toMatch(/job_status:\s*'submitted'/)
    expect(upload).not.toMatch(/run_status:\s*RUN_STATUS_NEEDS_REVIEW/)
    expect(upload).not.toMatch(/run_status:\s*'needs_review'/)
    expect(upload).not.toMatch(/run_status:\s*'submitted'/)
  })

  test('Phase 2 human review still writes needs_review', function () {
    var phase2 = sliceFunction(POLK_SRC, 'runPolkPhase2')
    expect(phase2).toMatch(/run_status:\s*RUN_STATUS_PHASE2_REVIEW/)
    expect(phase2).toMatch(/Mark Polk Phase 2 run needs_review/)
    expect(phase2).toMatch(/job_status:\s*'needs_review'/)
    expect(phase2).not.toMatch(/run_status:\s*RUN_STATUS_COMPLETE/)
    expect(phase2).not.toMatch(/run_status:\s*RUN_STATUS_PHASE1_SUCCESS/)
  })

  test('parcel not found still writes needs_review', function () {
    var parcelBlock = POLK_SRC.slice(
      POLK_SRC.indexOf("Parcel not found — marking needs_review"),
      POLK_SRC.indexOf('Resolving legal description')
    )
    expect(parcelBlock).toMatch(/run_status:\s*RUN_STATUS_NEEDS_REVIEW/)
    expect(parcelBlock).toMatch(/Mark automation run needs_review/)
    expect(parcelBlock).toMatch(/job_status:\s*'needs_review'/)
    expect(parcelBlock).not.toMatch(/run_status:\s*RUN_STATUS_COMPLETE/)
    expect(parcelBlock).not.toMatch(/run_status:\s*RUN_STATUS_ERROR/)
  })

  test('save failure still writes error', function () {
    var saveFailure = sliceFunction(POLK_SRC, 'markPhase1SaveFailure')
    expect(saveFailure).toMatch(/run_status:\s*RUN_STATUS_PHASE1_FAILURE/)
    expect(saveFailure).toMatch(/Mark automation run error after portal save failure/)
    expect(saveFailure).toMatch(/job_status:\s*'needs_review'/)
    expect(saveFailure).not.toMatch(/run_status:\s*RUN_STATUS_COMPLETE/)
    expect(saveFailure).not.toMatch(/run_status:\s*RUN_STATUS_NEEDS_REVIEW/)
  })

  test('Polk, Lee, and Hillsborough traverse the same shared Accela status writer', function () {
    expect(POLK_SRC).toMatch(/async function runAccelaPortal\(/)
    expect(POLK_SRC).toMatch(/return runAccelaPortal\(jobData, runId, runnerOptions, defaultConfig/)
    expect(LEE_SRC).toMatch(/const \{ runAccelaPortal \} = require\('\.\/polk-county\.runner'\)/)
    expect(LEE_SRC).toMatch(/return await runAccelaPortal\(jobData, runId, runnerOptions, leeConfig/)
    expect(HILLSBOROUGH_SRC).toMatch(/const \{ runAccelaPortal \} = require\('\.\/polk-county\.runner'\)/)
    expect(HILLSBOROUGH_SRC).toMatch(/return runAccelaPortal\(jobData, runId, opts, hillsboroughConfig/)
    ;[LEE_SRC, HILLSBOROUGH_SRC].forEach(function (src) {
      expect(src).not.toMatch(/from\('automation_runs'\)\.update/)
      expect(src).not.toMatch(/run_status:/)
    })
  })

  test('Lee login override does not replace shared status-writing logic', function () {
    expect(LEE_SRC).toMatch(/loginLeeAngularCommunityView/)
    expect(LEE_SRC).toMatch(/leeAwareLogStep/)
    expect(LEE_SRC).toMatch(/return await runAccelaPortal\(/)
    expect(LEE_SRC).not.toMatch(/RUN_STATUS_PHASE1_SUCCESS/)
    expect(LEE_SRC).not.toMatch(/RUN_STATUS_DOCUMENT_UPLOAD/)
  })

  test('an additional standard Accela AHJ inherits the shared writer and Lake does not', function () {
    expect(PASCO_SRC).toMatch(/const \{ runAccelaPortal \} = require\('\.\/polk-county\.runner'\)/)
    expect(PASCO_SRC).toMatch(/return runAccelaPortal\(jobData, runId, opts, pascoConfig/)
    expect(PASCO_SRC).not.toMatch(/from\('automation_runs'\)\.update/)
    expect(LAKE_SRC).toMatch(/does NOT call runAccelaPortal/)
    expect(LAKE_SRC).not.toMatch(/require\('\.\/polk-county\.runner'\)/)
  })

  test('shared Accela runner does not introduce completed, submitted, or failed run_status writers', function () {
    expect(POLK_SRC).not.toMatch(/run_status:\s*'completed'/)
    expect(POLK_SRC).not.toMatch(/run_status:\s*'submitted'/)
    expect(POLK_SRC).not.toMatch(/run_status:\s*'failed'/)
    expect(POLK_SRC).not.toMatch(/RUN_STATUS_COMPLETED/)
    expect(POLK_SRC).not.toMatch(/RUN_STATUS_SUBMITTED/)
    expect(POLK_SRC).not.toMatch(/RUN_STATUS_FAILED/)
  })
})
