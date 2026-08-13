/**
 * Charlotte County Accela runner — Angular CommunityView peer.
 *
 * workflow_file: charlotte-county.runner.js
 * Portal: https://aca-prod.accela.com/BOCC
 *
 * Login family (public 2026-08-13): Angular CommunityView — performLogin hook.
 * Submit hard-blocked. Attachments fail-closed until confirmed.
 */

const charlotteConfig = require('./configs/charlotte-county.config')
const { readLegalDescriptionFromPortal } = require('../../lib/parcels/polk-legal-description')
const {
  clearSession,
  isAccelaSessionValid,
} = require('../../lib/automation/session-store')
const { runAccelaPortal } = require('./polk-county.runner')

async function loadCredentials(companyId, ahjId) {
  try {
    var mod = await import('../../lib/credentials/secure-credential-service.js')
    return await mod.getCredentials(companyId, ahjId)
  } catch (serviceErr) {
    var { createClient } = require('@supabase/supabase-js')
    var ws = require('ws')
    var supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { realtime: { transport: ws } }
    )
    var { data, error } = await supabase
      .from('company_ahj_credentials')
      .select('username, portal_password, password_encrypted')
      .eq('company_id', companyId)
      .eq('ahj_id', ahjId)
      .eq('is_active', true)
      .single()
    if (error || !data) {
      throw Object.assign(
        new Error('No credentials found for this company and AHJ'),
        { errorCode: 'missing_credentials', cause: serviceErr.message }
      )
    }
    var password = data.portal_password
    if (!password && data.password_encrypted) {
      var crypto = await import('../../lib/crypto/credential-encryption.js')
      password = crypto.decryptCredential(data.password_encrypted)
    }
    if (!password) {
      throw Object.assign(
        new Error('Credentials exist but password is missing or unreadable'),
        { errorCode: 'missing_credentials' }
      )
    }
    return { username: data.username, password: password }
  }
}

async function loginCharlotteAngularCommunityView(page, credentials, config, companyId) {
  var selectors = config.selectors
  var sessionProvider = config.sessionProvider || 'charlotte_accela'

  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var sessionOk = await isAccelaSessionValid(page)
  if (sessionOk) {
    console.log('[charlotte_accela] Using saved session — skipping login ✓')
    return
  }

  console.log('[charlotte_accela] Session expired or missing — logging in fresh')
  if (companyId) await clearSession(sessionProvider, companyId)

  await page.goto(config.portalUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var frame = page.frame({ url: selectors.loginFrameUrlPattern })
  if (!frame) {
    throw Object.assign(
      new Error('Charlotte Angular CommunityView login iframe not found'),
      { errorCode: 'login_failed' }
    )
  }

  await frame.locator(selectors.loginUsername).fill(credentials.username)
  await frame.locator(selectors.loginPassword).fill(credentials.password)
  await frame.locator(selectors.loginSubmit).click()

  await page.waitForURL(selectors.loginSuccessUrl, { timeout: 15000 })
  await page.waitForTimeout(2000)
  console.log('[charlotte_accela] Login complete — session will be saved for next run')
}

async function resolveCharlotteLegalDescription(page, parcelNumber, selectors) {
  return readLegalDescriptionFromPortal(page, selectors)
}

function charlotteHooks() {
  return {
    resolveLegalDescription: resolveCharlotteLegalDescription,
    performLogin: loginCharlotteAngularCommunityView,
  }
}

async function createCharlotteApplication(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, { runType: 'permit_phase_1' }),
    charlotteConfig,
    charlotteHooks()
  )
}

async function uploadCharlotteDocuments(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, {
      runType: 'permit_document_upload',
      runPayload: (runnerOptions && runnerOptions.runPayload) || {},
    }),
    charlotteConfig,
    charlotteHooks()
  )
}

async function submitCharlotteApplication(_jobData, _runId, _runnerOptions) {
  throw Object.assign(
    new Error(
      'Charlotte permit_submit is disabled; Accela submit/payment requires human approval ' +
        '(same hard-stop policy as Polk). Complete Review in-portal after Phase 1 / document upload.'
    ),
    { errorCode: 'unsupported_run_type' }
  )
}

async function runCharlotteCounty(jobData, runId, runnerOptions) {
  var opts = runnerOptions || {}
  var runType = opts.runType || 'permit_phase_1'

  console.log('[charlotte] Starting', {
    runId: runId,
    jobId: jobData && jobData.id,
    runType: runType,
    portalUrl: charlotteConfig.portalUrl,
  })

  if (runType === 'permit_submit') {
    return submitCharlotteApplication(jobData, runId, opts)
  }

  await loadCredentials(jobData.company_id, jobData.ahj_id)

  if (runType === 'permit_document_upload') {
    return uploadCharlotteDocuments(jobData, runId, opts)
  }
  if (runType === 'permit_resume') {
    return runAccelaPortal(jobData, runId, opts, charlotteConfig, charlotteHooks())
  }
  return createCharlotteApplication(jobData, runId, opts)
}

module.exports = {
  runCharlotteCounty,
  loginCharlotteAngularCommunityView,
  createCharlotteApplication,
  uploadCharlotteDocuments,
  submitCharlotteApplication,
  charlotteConfig,
}
