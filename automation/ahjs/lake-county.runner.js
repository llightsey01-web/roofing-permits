/**
 * Lake County, FL — OPRS fail-closed stub (NOT Accela).
 *
 * workflow_file: lake-county.runner.js
 * Portal: https://mcdplus.lakecountyfl.gov/oprs_PT/
 *
 * Public inspection 2026-08-13 found the Accela backlog seed URL
 * (aca-prod.accela.com/LAKECO) points at Lake County, California — not Florida.
 * Florida Lake County Building Services uses OPRS (oprswebv2.dll), a different
 * platform family. This runner intentionally does NOT call runAccelaPortal.
 *
 * All run types fail closed until a dedicated OPRS automation path is authorized.
 * Submit remains hard-blocked.
 */

const lakeConfig = require('./configs/lake-county.config')

var PLATFORM_BLOCK =
  'Lake County FL uses OPRS (mcdplus.lakecountyfl.gov/oprs_PT), not Accela. ' +
  'Seeded URL aca-prod.accela.com/LAKECO is Lake County California. ' +
  'Accela peer runners must not be used. Dedicated OPRS automation is not implemented.'

function rejectLakeAutomation(step) {
  throw Object.assign(
    new Error(PLATFORM_BLOCK + ' Blocked step: ' + step + '.'),
    {
      errorCode: 'unsupported_platform',
      platform: 'oprs',
      portalUrl: lakeConfig.portalUrl,
      configId: lakeConfig.id,
    }
  )
}

async function loginLakeCounty() {
  return rejectLakeAutomation('login')
}

async function createLakeApplication() {
  return rejectLakeAutomation('create_application')
}

async function uploadLakeDocuments() {
  return rejectLakeAutomation('upload_documents')
}

async function submitLakeApplication() {
  throw Object.assign(
    new Error(
      'Lake County permit_submit is disabled (hard-blocked). Platform is OPRS, not Accela; ' +
        'no payment/submit automation is authorized.'
    ),
    { errorCode: 'unsupported_run_type' }
  )
}

async function runLakeCounty(jobData, runId, runnerOptions) {
  var opts = runnerOptions || {}
  var runType = opts.runType || 'permit_phase_1'

  console.log('[lake] Starting (fail-closed OPRS stub)', {
    runId: runId,
    jobId: jobData && jobData.id,
    runType: runType,
    portalUrl: lakeConfig.portalUrl,
    platform: 'oprs',
  })

  if (runType === 'permit_submit') {
    return submitLakeApplication()
  }

  return rejectLakeAutomation(runType)
}

module.exports = {
  runLakeCounty,
  loginLakeCounty,
  createLakeApplication,
  uploadLakeDocuments,
  submitLakeApplication,
  lakeConfig,
}
