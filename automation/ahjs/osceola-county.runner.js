/**
 * Osceola County Accela runner — self-hosted legacy LoginBox peer.
 *
 * workflow_file: osceola-county.runner.js
 * Portal: https://permits.osceola.org/CitizenAccess (agency_code=OSCEOLA)
 *
 * Login family (public 2026-08-13): legacy Accela LoginBox (email/password),
 * NOT Angular CommunityView and NOT Polk reCAPTCHA — performLogin hook required
 * so Polk's captcha solver path is never entered.
 *
 * Submit hard-blocked. Attachments fail-closed until confirmed.
 * Never target aca-prod.accela.com/OSCEOLA for filings.
 */

const osceolaConfig = require('./configs/osceola-county.config')
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

/**
 * Legacy LoginBox login — page-level email/password (no iframe, no reCAPTCHA).
 */
async function loginOsceolaLegacyLoginBox(page, credentials, config, companyId) {
  var selectors = config.selectors
  var sessionProvider = config.sessionProvider || 'osceola_accela'

  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var sessionOk = await isAccelaSessionValid(page)
  if (sessionOk) {
    console.log('[osceola_accela] Using saved session — skipping login ✓')
    return
  }

  console.log('[osceola_accela] Session expired or missing — logging in fresh (legacy LoginBox)')
  if (companyId) await clearSession(sessionProvider, companyId)

  await page.goto(config.portalUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var user = page.locator(selectors.loginUsername)
  var pass = page.locator(selectors.loginPassword)
  var submit = page.locator(selectors.loginSubmit)

  if ((await user.count()) === 0 || (await pass.count()) === 0) {
    throw Object.assign(
      new Error('Osceola legacy LoginBox fields not found on Login.aspx'),
      { errorCode: 'login_failed' }
    )
  }

  await user.fill(credentials.username)
  await pass.fill(credentials.password)
  await submit.click()

  // Self-hosted success lands on Welcome / authenticated shell — accept either
  await Promise.race([
    page.waitForURL(selectors.loginSuccessUrl, { timeout: 20000 }),
    page.waitForURL('**/CitizenAccess/**', { timeout: 20000 }),
  ]).catch(function () {
    /* fall through to post-login check */
  })
  await page.waitForTimeout(2000)

  var stillOnLogin =
    page.url().toLowerCase().indexOf('login.aspx') !== -1 &&
    (await page.locator(selectors.loginUsername).count()) > 0
  if (stillOnLogin) {
    throw Object.assign(
      new Error('Osceola login did not leave Login.aspx — credentials or portal rejection'),
      { errorCode: 'login_failed' }
    )
  }

  console.log('[osceola_accela] Login complete — session will be saved for next run')
}

async function resolveOsceolaLegalDescription(page, parcelNumber, selectors) {
  return readLegalDescriptionFromPortal(page, selectors)
}

function osceolaHooks() {
  return {
    resolveLegalDescription: resolveOsceolaLegalDescription,
    performLogin: loginOsceolaLegacyLoginBox,
  }
}

async function createOsceolaApplication(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, { runType: 'permit_phase_1' }),
    osceolaConfig,
    osceolaHooks()
  )
}

async function uploadOsceolaDocuments(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, {
      runType: 'permit_document_upload',
      runPayload: (runnerOptions && runnerOptions.runPayload) || {},
    }),
    osceolaConfig,
    osceolaHooks()
  )
}

async function submitOsceolaApplication(_jobData, _runId, _runnerOptions) {
  throw Object.assign(
    new Error(
      'Osceola permit_submit is disabled; Accela submit/payment requires human approval ' +
        '(same hard-stop policy as Polk). Complete Review in-portal after Phase 1 / document upload.'
    ),
    { errorCode: 'unsupported_run_type' }
  )
}

async function runOsceolaCounty(jobData, runId, runnerOptions) {
  var opts = runnerOptions || {}
  var runType = opts.runType || 'permit_phase_1'

  console.log('[osceola] Starting', {
    runId: runId,
    jobId: jobData && jobData.id,
    runType: runType,
    portalUrl: osceolaConfig.portalUrl,
    agencyCode: 'OSCEOLA',
    hosting: 'self-hosted',
  })

  if (runType === 'permit_submit') {
    return submitOsceolaApplication(jobData, runId, opts)
  }

  await loadCredentials(jobData.company_id, jobData.ahj_id)

  if (runType === 'permit_document_upload') {
    return uploadOsceolaDocuments(jobData, runId, opts)
  }
  if (runType === 'permit_resume') {
    return runAccelaPortal(jobData, runId, opts, osceolaConfig, osceolaHooks())
  }
  return createOsceolaApplication(jobData, runId, opts)
}

module.exports = {
  runOsceolaCounty,
  loginOsceolaLegacyLoginBox,
  createOsceolaApplication,
  uploadOsceolaDocuments,
  submitOsceolaApplication,
  osceolaConfig,
}
