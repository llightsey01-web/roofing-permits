/**
 * Hillsborough County Accela runner — peer of Polk/Lee.
 *
 * workflow_file: hillsborough-county.runner.js
 * Portal: https://aca-prod.accela.com/HCFL (HillsGovHub)
 *
 * Architecture: Angular CommunityView login (like Lee) via hooks.performLogin +
 * shared runAccelaPortal (Polk) for Cap flow, logStep screenshots, sessions,
 * preflight, and handleRunError.
 *
 * Logical steps (runType mapping):
 *   login              → hooks.performLogin (Angular login-panel iframe)
 *   create application → permit_phase_1
 *   upload documents   → permit_document_upload (fail-closed until attachments confirmed)
 *   submit             → permit_submit disabled (human review / no auto-pay; same as Polk)
 *
 * Cannot be fully E2E-tested until HILLSBOROUGH_COUNTY vault credentials exist.
 */

const hillsboroughConfig = require('./configs/hillsborough-county.config')
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
 * STEP: login
 * Angular CommunityView iframe (publicly confirmed 2026-08-12 on HCFL Login.aspx).
 * No reCAPTCHA on outer page (Lee-like). Session reuse via session-store.
 */
async function loginHillsboroughAngularCommunityView(page, credentials, config, companyId) {
  var selectors = config.selectors
  var sessionProvider = config.sessionProvider || 'hillsborough_accela'

  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var sessionOk = await isAccelaSessionValid(page)
  if (sessionOk) {
    console.log('[hillsborough_accela] Using saved session — skipping login ✓')
    return
  }

  console.log('[hillsborough_accela] Session expired or missing — logging in fresh')
  if (companyId) await clearSession(sessionProvider, companyId)

  await page.goto(config.portalUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(config.loginWaitMs || 3000)

  var frame = page.frame({ url: selectors.loginFrameUrlPattern })
  if (!frame) {
    throw Object.assign(
      new Error('Hillsborough Angular CommunityView login iframe not found'),
      { errorCode: 'login_failed' }
    )
  }

  await frame.locator(selectors.loginUsername).fill(credentials.username)
  await frame.locator(selectors.loginPassword).fill(credentials.password)
  await frame.locator(selectors.loginSubmit).click()

  await page.waitForURL(selectors.loginSuccessUrl, { timeout: 15000 })
  await page.waitForTimeout(2000)
  console.log('[hillsborough_accela] Login complete — session will be saved for next run')
}

async function resolveHillsboroughLegalDescription(page, parcelNumber, selectors) {
  return readLegalDescriptionFromPortal(page, selectors)
}

function hillsboroughHooks() {
  return {
    resolveLegalDescription: resolveHillsboroughLegalDescription,
    performLogin: loginHillsboroughAngularCommunityView,
  }
}

/** STEP: create application — Accela Phase 1 via shared engine */
async function createHillsboroughApplication(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, { runType: 'permit_phase_1' }),
    hillsboroughConfig,
    hillsboroughHooks()
  )
}

/**
 * STEP: upload documents — shared permit_document_upload.
 * Fail-closed while postSubmitAttachments.confirmedForRoofingPermit === false.
 */
async function uploadHillsboroughDocuments(jobData, runId, runnerOptions) {
  return runAccelaPortal(
    jobData,
    runId,
    Object.assign({}, runnerOptions || {}, {
      runType: 'permit_document_upload',
      runPayload: (runnerOptions && runnerOptions.runPayload) || {},
    }),
    hillsboroughConfig,
    hillsboroughHooks()
  )
}

/**
 * STEP: submit — Polk-equivalent hard stop (no Accela payment automation).
 */
async function submitHillsboroughApplication(_jobData, _runId, _runnerOptions) {
  throw Object.assign(
    new Error(
      'Hillsborough permit_submit is disabled; Accela submit/payment requires human approval ' +
        '(same hard-stop policy as Polk). Complete Review in-portal after Phase 1 / document upload.'
    ),
    { errorCode: 'unsupported_run_type' }
  )
}

async function runHillsboroughCounty(jobData, runId, runnerOptions) {
  var opts = runnerOptions || {}
  var runType = opts.runType || 'permit_phase_1'

  console.log('[hillsborough] Starting', {
    runId: runId,
    jobId: jobData && jobData.id,
    runType: runType,
    portalUrl: hillsboroughConfig.portalUrl,
  })

  // Credentials are loaded inside runAccelaPortal; this early check fails fast
  // with the same missing_credentials path before launching Chromium on submit-only.
  if (runType === 'permit_submit') {
    return submitHillsboroughApplication(jobData, runId, opts)
  }

  // Warm-path credential probe (same store as runAccelaPortal) without logging secrets
  await loadCredentials(jobData.company_id, jobData.ahj_id)

  if (runType === 'permit_document_upload') {
    return uploadHillsboroughDocuments(jobData, runId, opts)
  }
  if (runType === 'permit_resume') {
    return runAccelaPortal(jobData, runId, opts, hillsboroughConfig, hillsboroughHooks())
  }
  return createHillsboroughApplication(jobData, runId, opts)
}

module.exports = {
  runHillsboroughCounty,
  loginHillsboroughAngularCommunityView,
  createHillsboroughApplication,
  uploadHillsboroughDocuments,
  submitHillsboroughApplication,
  hillsboroughConfig,
}
