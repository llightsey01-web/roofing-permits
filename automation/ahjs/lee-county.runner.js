const leeConfig = require('./configs/lee-county.config')
const { readLegalDescriptionFromPortal } = require('../../lib/parcels/polk-legal-description')

const screenshotPath = require.resolve('../shared/screenshot')
const polkPath = require.resolve('./polk-county.runner')

// Re-require Polk after patching logStep so the runner picks up the Lee login interceptor.
delete require.cache[polkPath]
delete require.cache[screenshotPath]

const screenshotMod = require('../shared/screenshot')
const originalLogStep = screenshotMod.logStep
var leeLoginContext = null

screenshotMod.logStep = async function leeAwareLogStep(page, runId, stepNumber, stepName, fn) {
  if (stepName === 'login' && leeLoginContext) {
    var ctx = leeLoginContext
    return originalLogStep(page, runId, stepNumber, stepName, async function() {
      await loginLeeAngularCommunityView(page, ctx.credentials, ctx.config)
    })
  }
  return originalLogStep.apply(this, arguments)
}

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
 * Lee County Accela login — Angular CommunityView panel in an iframe, no reCAPTCHA.
 */
async function loginLeeAngularCommunityView(page, credentials, config) {
  var selectors = config.selectors

  await page.goto(config.portalUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var frame = page.frame({ url: selectors.loginFrameUrlPattern })
  if (!frame) {
    throw Object.assign(
      new Error('Lee Angular CommunityView login iframe not found'),
      { errorCode: 'login_failed' }
    )
  }

  await frame.locator(selectors.loginUsername).fill(credentials.username)
  await frame.locator(selectors.loginPassword).fill(credentials.password)
  await frame.locator(selectors.loginSubmit).click()

  await page.waitForURL(selectors.loginSuccessUrl, { timeout: 15000 })
  await page.waitForTimeout(2000)
}

async function resolveLeeLegalDescription(page, parcelNumber, selectors) {
  return readLegalDescriptionFromPortal(page, selectors)
}

async function runLeeCounty(jobData, runId, runnerOptions) {
  var credentials = await loadCredentials(jobData.company_id, jobData.ahj_id)

  leeLoginContext = { credentials: credentials, config: leeConfig }
  try {
    return await runAccelaPortal(jobData, runId, runnerOptions, leeConfig, {
      resolveLegalDescription: resolveLeeLegalDescription,
    })
  } finally {
    leeLoginContext = null
  }
}

module.exports = { runLeeCounty, loginLeeAngularCommunityView }
