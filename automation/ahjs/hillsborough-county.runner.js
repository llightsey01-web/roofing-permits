/**
 * Hillsborough County Accela runner — SCAFFOLD ONLY.
 *
 * workflow_file basename (matches Polk/Lee convention stored on ahj_portals):
 *   hillsborough-county.runner.js
 *
 * Portal: https://aca-prod.accela.com/hcfl
 * Expected credential_key: HILLSBOROUGH_COUNTY
 * Session provider (planned): hillsborough_accela
 *
 * Consumers: worker/runner.js and automation/runner.js switch on workflow_file.
 * Those switch cases are NOT wired yet — add loadHillsboroughRunner /
 * case 'hillsborough-county.runner.js' before flipping is_active.
 *
 * TODO: Real portal credentials + selector discovery required before any step
 * below can be implemented and tested. Do not run against live HCFL until then.
 */

const path = require('path')

// Inline stub config — extract to configs/hillsborough-county.config.js once
// login type + selectors are verified against the live HCFL Accela tenant.
const hillsboroughConfig = {
  id: 'hillsborough-county',
  name: 'Hillsborough County Building Department',
  state: 'FL',
  portalUrl: 'https://aca-prod.accela.com/hcfl',
  // TODO: confirm loginType (accela_legacy vs accela_angular) with real credentials
  loginType: 'TODO_confirm_with_credentials',
  captchaType: 'TODO_confirm_with_credentials',
  workflowFile: 'hillsborough-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'HILLSBOROUGH_COUNTY',
  sessionProvider: 'hillsborough_accela',
  permitType: 'TODO_confirm_permit_type_label',
  version: 0,
  lastVerified: null,
  selectors: {
    // TODO: fill after authenticated portal inspection
    loginUsername: 'TODO',
    loginPassword: 'TODO',
    loginSubmit: 'TODO',
  },
}

function stubNotImplemented(section) {
  return Object.assign(
    new Error(
      '[hillsborough] TODO: ' +
        section +
        ' — needs real HCFL portal credentials to implement and test ' +
        '(file: ' +
        path.basename(__filename) +
        ')'
    ),
    { errorCode: 'runner_scaffold_stub' }
  )
}

// TODO: login — needs real credentials to complete and test
async function stubLogin(_page, _credentials, _config) {
  throw stubNotImplemented('login')
}

// TODO: create application (disclaimer → permit type → address/parcel) — needs real credentials to complete and test
async function stubCreateApplication(_page, _jobData, _config) {
  throw stubNotImplemented('create application')
}

// TODO: upload documents — needs real credentials to complete and test
async function stubUploadDocuments(_page, _jobData, _config) {
  throw stubNotImplemented('upload documents')
}

// TODO: submit — needs real credentials to complete and test
async function stubSubmit(_page, _jobData, _config) {
  throw stubNotImplemented('submit')
}

/**
 * Entry point expected by worker/runner.js / automation/runner.js once wired.
 * @param {object} jobData
 * @param {string} runId
 * @param {object} [runnerOptions]
 */
async function runHillsboroughCounty(jobData, runId, runnerOptions) {
  console.log('[hillsborough] Scaffold runner invoked', {
    runId: runId,
    jobId: jobData && jobData.id,
    portalUrl: hillsboroughConfig.portalUrl,
    runType: runnerOptions && runnerOptions.runType,
  })

  // TODO: load credentials via secure-credential-service.getCredentials(companyId, ahjId)
  // once HILLSBOROUGH_COUNTY vault rows exist. Do not hardcode credentials.
  // TODO: launch Playwright + restore session (sessionProvider=hillsborough_accela) — needs real credentials

  var page = null
  var credentials = null

  await stubLogin(page, credentials, hillsboroughConfig)
  await stubCreateApplication(page, jobData, hillsboroughConfig)
  await stubUploadDocuments(page, jobData, hillsboroughConfig)
  await stubSubmit(page, jobData, hillsboroughConfig)
}

module.exports = {
  runHillsboroughCounty,
  hillsboroughConfig,
}
