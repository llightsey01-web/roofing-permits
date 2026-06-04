// automation/ahjs/shared/base-runner.js
// Universal base for AHJ portal runners — lifecycle, logging, checkpoints, browser

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.local') })

const { chromium } = require('playwright')
const { logStep } = require('../../shared/screenshot')
const { handleRunError } = require('../../shared/errors')
const { shouldSkipStep } = require('../../shared/checkpoint')
const { logRecoveryStart } = require('../../shared/recovery')
const { validateAhjConfig } = require('../config-validator')

function getSupabase() {
  const ws = require('ws')
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function loadCredentials(companyId, ahjId) {
  try {
    var mod = await import('../../../lib/credentials/secure-credential-service.js')
    return await mod.getCredentials(companyId, ahjId)
  } catch (serviceErr) {
    var supabase = getSupabase()
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
      var crypto = await import('../../../lib/crypto/credential-encryption.js')
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

function runPreflight(config, jobData) {
  var checks = config.preflightChecks || []
  var failures = []
  for (var i = 0; i < checks.length; i++) {
    var check = checks[i]
    if (check.field && !jobData[check.field]) failures.push(check.message)
    if (check.docType) {
      var found = jobData.documents && jobData.documents.some(function(d) {
        return d.document_type === check.docType
      })
      if (!found) failures.push(check.message)
    }
  }
  if (failures.length > 0) {
    failures.forEach(function(f) { console.log('  — ' + f) })
    throw Object.assign(new Error('Preflight failed'), { errorCode: 'missing_document', failures: failures })
  }
  console.log('[base-runner] ✓ Preflight passed')
}

async function launchBrowser(runnerOptions) {
  var opts = runnerOptions || {}
  var browser = await chromium.launch({
    headless: opts.headless !== undefined ? opts.headless : true,
    slowMo: opts.slowMo || 300,
  })
  var page = await browser.newPage()
  page.setDefaultTimeout(opts.defaultTimeout || 45000)
  return { browser: browser, page: page }
}

/**
 * Run a single step with checkpoint skip guard + logStep (screenshot + DB log).
 */
async function runStep(ctx, stepNumber, stepName, fn, checkpointData) {
  if (await shouldSkipStep(ctx.runId, stepNumber)) {
    console.log('[base-runner] ↷ Step ' + stepNumber + ': ' + stepName + ' (skipped — checkpoint)')
    return { success: true, skipped: true }
  }
  return logStep(ctx.page, ctx.runId, stepNumber, stepName, fn, checkpointData)
}

/**
 * Standard automation lifecycle: validate config, recovery, preflight, browser, steps, cleanup.
 *
 * @param {object} options
 * @param {object} options.jobData
 * @param {string} options.runId
 * @param {object} options.runnerOptions
 * @param {object} options.config — AHJ portal config
 * @param {object} [options.hooks]
 * @param {function} options.executeSteps — async (ctx) => void; ctx has page, config, credentials, resume, stepNumber ref
 */
async function runAutomationLifecycle(options) {
  var jobData = options.jobData
  var runId = options.runId
  var runnerOptions = options.runnerOptions || {}
  var config = options.config
  var hooks = options.hooks || {}
  var executeSteps = options.executeSteps

  if (!config) throw new Error('AHJ config is required')
  if (typeof executeSteps !== 'function') throw new Error('executeSteps callback is required')

  validateAhjConfig(config)

  console.log('\n[base-runner] Starting ' + config.name)
  console.log('[base-runner] Job: ' + (jobData.owner_name || 'unknown') + ' — ' + (jobData.property_address || ''))
  console.log('[base-runner] Run ID: ' + runId + '\n')

  var resume = await logRecoveryStart(runId)
  var startFromStep = resume.isResume ? resume.stepNumber : 0
  console.log('[base-runner] Recovery startFromStep:', startFromStep)

  runPreflight(config, jobData)

  console.log('[base-runner] Loading AHJ credentials...')
  var credentials = await loadCredentials(jobData.company_id, jobData.ahj_id)
  console.log('[base-runner] ✓ Credentials loaded for: ' + credentials.username + '\n')

  var browser = null
  var page = null

  try {
    var launched = await launchBrowser(runnerOptions)
    browser = launched.browser
    page = launched.page

    var ctx = {
      jobData: jobData,
      runId: runId,
      runnerOptions: runnerOptions,
      config: config,
      hooks: hooks,
      credentials: credentials,
      resume: resume,
      page: page,
      browser: browser,
      stepNumber: 0,
      runStep: function(stepNumber, stepName, fn, checkpointData) {
        return runStep(ctx, stepNumber, stepName, fn, checkpointData)
      },
    }

    await executeSteps(ctx)
  } catch (err) {
    if (!err.phase1Handled) {
      await handleRunError(runId, jobData.id, err)
    }
    throw err
  } finally {
    if (browser) {
      await browser.close()
      console.log('[base-runner] Browser closed')
    }
  }
}

module.exports = {
  validateAhjConfig,
  logRecoveryStart,
  logStep,
  shouldSkipStep,
  runStep,
  runPreflight,
  loadCredentials,
  launchBrowser,
  runAutomationLifecycle,
  getSupabase,
}
