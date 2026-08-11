require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError } = require('../shared/errors')
const defaultConfig = require('./configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')
const { resolvePolkLegalDescription } = require('../../lib/parcels/polk-legal-description')
const { triggerNocAfterPhase1 } = require('../../lib/automation/noc-trigger')
const { saveCheckpoint, shouldSkipStep } = require('../shared/checkpoint.js')
const { logRecoveryStart } = require('../shared/recovery.js')
const { preflightCheckSelectors } = require('./shared/selector-preflight.js')
const { isAutomationEnabled } = require('../../lib/automation/automation-gate.js')
const { logRunAction } = require('../../lib/audit/run-logger.js')
const {
  loadSession,
  saveSession,
  clearSession,
  isAccelaSessionValid,
} = require('../../lib/automation/session-store')
const {
  resolvePostSubmitUploadPlan,
  isPostSubmitAttachmentSurface,
  assertUploadSelectorsConfirmed,
} = require('./polk-document-upload.js')
const os = require('os')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function assertSupabaseOk(result, label) {
  if (result.error) {
    throw Object.assign(
      new Error(label + ' failed: ' + result.error.message),
      { errorCode: 'database_error', supabaseError: result.error }
    )
  }
}

// Valid automation_runs.run_status values: queued, running, error, needs_review, cancelled
var RUN_STATUS_PHASE1_SUCCESS = 'needs_review'
var RUN_STATUS_PHASE1_FAILURE = 'error'
var RUN_STATUS_PHASE2_REVIEW = 'needs_review'
var RUN_STATUS_DOCUMENT_UPLOAD = 'needs_review'

function validatePolkRunContract(runType, runPayload) {
  var type = runType || 'permit_phase_1'
  if (type === 'permit_submit') {
    throw Object.assign(
      new Error('Polk permit_submit is disabled; automation stops at Review'),
      { errorCode: 'unsupported_run_type' }
    )
  }
  if (
    type !== 'permit_phase_1' &&
    type !== 'permit_resume' &&
    type !== 'permit_document_upload'
  ) {
    throw Object.assign(
      new Error('Unsupported Polk permit run type: ' + type),
      { errorCode: 'unsupported_run_type' }
    )
  }
  if (type === 'permit_resume' || type === 'permit_document_upload') {
    var recordNumber = runPayload && typeof runPayload.portal_record_number === 'string'
      ? runPayload.portal_record_number.trim()
      : ''
    if (!recordNumber) {
      throw Object.assign(
        new Error(
          type + ' requires current automation_runs.payload.portal_record_number'
        ),
        { errorCode: 'missing_portal_record_number' }
      )
    }
    return { runType: type, portalRecordNumber: recordNumber }
  }
  return { runType: type, portalRecordNumber: null }
}

function resolvePolkPhase2Values(jobData, config) {
  var defaults = config.resolvePortalDefaults(jobData)
  var jobSpecs = jobData.job_specs || {}
  var roofSpecs = jobData.roof_specs || {}
  var values = {
    gateCodeRequired: defaults.gateCodeRequired,
    gateCode: defaults.gateCode || '',
    codeViolation: defaults.codeViolation,
    codeViolationCaseNumber: defaults.codeViolationCaseNumber || '',
    applicantIsOwner: false,
    virtualInspections: false,
    privateProvider: false,
    packetSubmission: config.defaultValues.packetSubmission,
    fs119Status: defaults.fs119Status,
    workType: String(jobData.work_type || '').trim(),
    propertyType: config.defaultValues.propertyType,
    reroofPermitType: defaults.reroofPermitType,
    numberOfSquares: String(jobSpecs.squares || roofSpecs.squares || '').trim(),
    roofType: String(jobData.roof_type || '').trim(),
    reroofAffidavit: true,
    asbestosStatement: true,
    jobDescription: String(jobData.scope_of_work || '').trim(),
    jobValue: String(jobData.valuation || '').trim(),
    planUploadAcknowledgement: true,
    commercialFranchiseHolderName: '',
    commercialFranchiseHolderPhone: '',
    disposalEquipment: '',
    disposalFrequency: '',
  }

  var missing = []
  ;[
    ['work_type', values.workType],
    ['roof_type', values.roofType],
    ['job_specs.squares', values.numberOfSquares],
    ['scope_of_work', values.jobDescription],
    ['valuation', values.jobValue],
  ].forEach(function(entry) {
    if (!entry[1]) missing.push(entry[0])
  })
  if (missing.length) {
    throw Object.assign(
      new Error('Polk Phase 2 requires: ' + missing.join(', ')),
      { errorCode: 'missing_phase2_data', fields: missing }
    )
  }
  if (values.gateCodeRequired && !values.gateCode) {
    throw Object.assign(new Error('Gate Code override is Yes but no gate_code was supplied'), { errorCode: 'missing_phase2_data' })
  }
  if (values.codeViolation && !values.codeViolationCaseNumber) {
    throw Object.assign(
      new Error('Code Violation override is Yes but no code_violation_case_number was supplied'),
      { errorCode: 'missing_phase2_data' }
    )
  }
  if (config.enums.workType.indexOf(values.workType) < 0) {
    throw Object.assign(new Error('Unsupported Polk work_type: ' + values.workType), { errorCode: 'invalid_portal_enum' })
  }
  if (config.enums.roofType.indexOf(values.roofType) < 0) {
    throw Object.assign(new Error('Unsupported Polk roof_type: ' + values.roofType), { errorCode: 'invalid_portal_enum' })
  }
  if (config.enums.reroofPermitType.indexOf(values.reroofPermitType) < 0) {
    throw Object.assign(
      new Error('Unsupported Polk reroof permit type: ' + values.reroofPermitType),
      { errorCode: 'invalid_portal_enum' }
    )
  }
  return values
}

function paymentBoundaryPathname(url) {
  var location = String(url || '')
  if (!location) return ''
  // Playwright page.url() is absolute; still guard relative/invalid inputs.
  if (/^https?:\/\//i.test(location)) {
    try {
      return new URL(location).pathname || ''
    } catch (e) {
      // fall through to query/hash strip
    }
  }
  return location.split(/[?#]/)[0]
}

function isPaymentBoundaryState(url, currentStepLine, pageText) {
  var path = paymentBoundaryPathname(url)
  var stepLine = String(currentStepLine || '')
  var text = String(pageText || '')
  // Path-only URL checks — CapEdit query params include isFromShoppingCart= and must not match.
  return /\/ShoppingCart\//i.test(path) ||
    /\/payment\//i.test(path) ||
    /pay\.aspx/i.test(path) ||
    /checkout/i.test(path) ||
    /Step\s*5\s*:\s*Pay Fees/i.test(stepLine) ||
    /Payment information|PAY NOW|CSG Forte/i.test(text)
}

function redactReviewValue(label, value) {
  if (/owner|applicant|contact|address|email|phone|parcel/i.test(String(label || ''))) return '[REDACTED]'
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300)
}

async function waitForPortalPostbackQuiet(page, maxMs) {
  var deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    var loading = await page.evaluate(function() {
      function isElVisible(el) {
        if (!el) return false
        var style = window.getComputedStyle(el)
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null
      }
      return isElVisible(document.getElementById('divGlobalLoadingImg')) ||
        isElVisible(document.getElementById('divGlobalLoading')) ||
        isElVisible(document.getElementById('divLoadingTemplate'))
    }).catch(function() { return true })
    if (!loading) return
    await page.waitForTimeout(500)
  }
}

async function clickSaveAndResumeLater(page, config) {
  await page.evaluate(function() {
    var mask = document.getElementById('dvACADialogLayerMask')
    if (mask) mask.remove()
    document.querySelectorAll('.mask_iframe, iframe.mask_iframe').forEach(function(el) { el.remove() })
    document.querySelectorAll('[id*="Mask"], [class*="mask"]').forEach(function(el) {
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
    })
  })
  await page.waitForTimeout(500)
  var saveSelector = config.selectors.saveAndResumeBtn + ', a[onclick*="doSaveAndResume"]'
  await page.waitForSelector(saveSelector, { timeout: 10000 })
  var urlBefore = page.url()
  await page.click(saveSelector)
  await waitForPortalPostbackQuiet(page, 45000)
  await page.waitForTimeout(2000)
  return urlBefore
}

async function confirmPortalDraftSaved(page, urlBefore) {
  var state = await page.evaluate(function() {
    function isElVisible(el) {
      if (!el) return false
      var style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null
    }

    var errors = []
    document.querySelectorAll(
      '.ACA_Error, .ACA_ErrorMessageLabel, .validation-summary-errors, span[style*="color:Red"], span[style*="color:red"]'
    ).forEach(function(el) {
      var text = (el.innerText || el.textContent || '').trim()
      if (text) errors.push(text.substring(0, 300))
    })

    var successHints = []
    var bodyText = document.body ? document.body.innerText : ''
    bodyText.split('\n').forEach(function(line) {
      var trimmed = line.trim()
      if (trimmed && /saved|success|resume later|my records|draft|record saved/i.test(trimmed)) {
        successHints.push(trimmed.substring(0, 200))
      }
    })

    var applicationId = ''
    var params = new URLSearchParams(window.location.search)
    ;['capID', 'CapID', 'recordID', 'RecordId', 'RecordID'].forEach(function(key) {
      var val = params.get(key)
      if (val && !applicationId) applicationId = val
    })
    document.querySelectorAll('input[type="hidden"]').forEach(function(el) {
      var id = (el.id || '').toLowerCase()
      var name = (el.name || '').toLowerCase()
      if ((/capid|recordid|altid/.test(id) || /capid|recordid|altid/.test(name)) && el.value) {
        if (!applicationId) applicationId = el.value
      }
    })

    return {
      url: window.location.href,
      loading: isElVisible(document.getElementById('divGlobalLoadingImg')) ||
        isElVisible(document.getElementById('divGlobalLoading')),
      errors: errors,
      successHints: successHints,
      applicationId: applicationId,
    }
  }).catch(function() {
    return { url: page.url(), loading: false, errors: [], successHints: [], applicationId: '' }
  })

  var urlAfter = state.url || page.url()
  var navigatedAway = urlBefore !== urlAfter
  var onSavedDestination = /MyRecordsCap|Dashboard\.aspx|CapHome\.aspx/i.test(urlAfter)
  var stillOnCapEdit = /CapEdit\.aspx/i.test(urlAfter)
  var hasBlockingErrors = state.errors.length > 0 && !navigatedAway && !onSavedDestination
  var hasSuccessSignal = state.successHints.length > 0 || navigatedAway || onSavedDestination ||
    (stillOnCapEdit && !state.loading && state.errors.length === 0)

  if (hasBlockingErrors) {
    return {
      success: false,
      reason: 'Portal validation errors after Save and Resume Later: ' + state.errors.join(' | '),
      state: state,
    }
  }

  if (!hasSuccessSignal) {
    return {
      success: false,
      reason: 'Save and Resume Later did not redirect or show confirmation (url=' + urlAfter + ')',
      state: state,
    }
  }

  var savedAt = new Date().toISOString()
  var confirmation = state.successHints[0] ||
    (onSavedDestination ? 'Redirected after save to ' + urlAfter :
      stillOnCapEdit ? 'Save and Resume Later postback completed on CapEdit without validation errors' :
      'Save and Resume Later postback completed')

  return {
    success: true,
    portalSavedUrl: urlAfter,
    portalApplicationId: state.applicationId || null,
    portalSessionSavedAt: savedAt,
    portalConfirmation: confirmation,
    state: state,
  }
}

function buildPortalConfirmationPayload(saveResult) {
  return JSON.stringify({
    saved_at: saveResult.portalSessionSavedAt,
    saved_url: saveResult.portalSavedUrl,
    application_id: saveResult.portalApplicationId,
    confirmation: saveResult.portalConfirmation,
  })
}

async function markPhase1SaveFailure(supabase, runId, jobId, reason) {
  console.error('  ✗ Save and Resume Later failed: ' + reason)
  assertSupabaseOk(await supabase.from('automation_runs').update({
    run_status: RUN_STATUS_PHASE1_FAILURE,
    error_message: reason,
    completed_at: new Date().toISOString(),
  }).eq('id', runId), 'Mark automation run error after portal save failure')
  assertSupabaseOk(await supabase.from('jobs').update({ job_status: 'needs_review' }).eq('id', jobId), 'Mark job needs_review after portal save failure')
}

async function getCredentials(companyId, ahjId) {
  try {
    var mod = await import('../../lib/credentials/secure-credential-service.js')
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

var suffixMap = {
  'circle': 'Cir', 'cir': 'Cir',
  'street': 'St', 'st': 'St',
  'avenue': 'Ave', 'ave': 'Ave',
  'drive': 'Dr', 'dr': 'Dr',
  'boulevard': 'Blvd', 'blvd': 'Blvd',
  'lane': 'Ln', 'ln': 'Ln',
  'road': 'Rd', 'rd': 'Rd',
  'court': 'Ct', 'ct': 'Ct',
  'place': 'Pl', 'pl': 'Pl',
  'way': 'Way', 'trail': 'Trl', 'trl': 'Trl',
  'terrace': 'Ter', 'ter': 'Ter', 'loop': 'Loop'
}

function parseAddress(fullAddress) {
  var parts = fullAddress.trim().split(' ')
  var streetNo = parts[0]
  var lastWord = parts[parts.length - 1].toLowerCase()
  var normalizedSuffix = suffixMap[lastWord] || null
  var streetName = normalizedSuffix ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ')
  return { streetNo: streetNo, streetName: streetName, suffix: normalizedSuffix }
}

async function runAccelaPortal(jobData, runId, runnerOptions, portalConfig, hooks) {
  var config = portalConfig || defaultConfig
  var resolveLegalDescription = (hooks && hooks.resolveLegalDescription) || resolvePolkLegalDescription
  var browserOpts = runnerOptions || {}
  var runContract = { runType: 'permit_phase_1', portalRecordNumber: null }
  var phase2Values = null

  if (config.id === 'polk-county') {
    var gateSupabase = getSupabase()
    if (!(await isAutomationEnabled(gateSupabase))) {
      throw Object.assign(
        new Error('Automation is paused by platform_settings.automation_enabled'),
        { errorCode: 'automation_paused' }
      )
    }
    runContract = validatePolkRunContract(browserOpts.runType, browserOpts.runPayload)
  }

  console.log('\nStarting ' + config.name + ' automation')
  console.log('Job: ' + jobData.owner_name + ' — ' + jobData.property_address)
  console.log('Run ID: ' + runId + '\n')

  await preflightCheckSelectors(config, config.fieldMap, {
    runId: runId,
    jobData: jobData,
  })

  if (runContract.runType === 'permit_resume') {
    phase2Values = resolvePolkPhase2Values(jobData, config)
  }

  const failures = []
  for (const check of config.preflightChecks) {
    if (check.field && !jobData[check.field]) failures.push(check.message)
    if (check.docType) {
      const found = jobData.documents && jobData.documents.some(function(d) {
        return d.document_type === check.docType
      })
      if (!found) failures.push(check.message)
    }
  }
  if (failures.length > 0) {
    failures.forEach(function(f) { console.log('  — ' + f) })
    throw Object.assign(new Error('Preflight failed'), { errorCode: 'missing_document', failures: failures })
  }
  console.log('✓ Preflight passed\n')

  console.log('Loading AHJ credentials...')
  const credentials = await getCredentials(jobData.company_id, jobData.ahj_id)
  console.log('✓ Credentials loaded\n')

  console.log('Checking portal availability...')
  try {
    const res = await fetch(config.portalUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    if (res.status === 502 || res.status === 503) {
      throw Object.assign(new Error('Portal is down'), { errorCode: 'portal_down' })
    }
    console.log('✓ Portal is reachable\n')
  } catch (err) {
    if (err.errorCode === 'portal_down') throw err
    console.log('Portal check inconclusive — proceeding anyway')
  }

  const solver = new Solver(process.env.TWOCAPTCHA_API_KEY)
  const sessionProvider = config.sessionProvider || 'polk_accela'
  const companyId = jobData.company_id
  const savedSession = await loadSession(sessionProvider, companyId)
  const browser = await chromium.launch({
    headless: browserOpts.headless !== undefined ? browserOpts.headless : true,
    slowMo: browserOpts.slowMo || 300,
  })
  const context = savedSession
    ? await browser.newContext({ storageState: savedSession })
    : await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  let stepNumber = 0

  async function removeOverlay() {
    await page.evaluate(function() {
      var mask = document.getElementById('dvACADialogLayerMask')
      if (mask) mask.remove()
      document.querySelectorAll('.mask_iframe, iframe.mask_iframe').forEach(function(el) { el.remove() })
      document.querySelectorAll('[id*="Mask"], [class*="mask"]').forEach(function(el) {
        el.style.display = 'none'
        el.style.pointerEvents = 'none'
      })
    })
    await page.waitForTimeout(500)
  }

  async function safeClick(selector) {
    await removeOverlay()
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, selector)
    await page.waitForTimeout(300)
  }

  async function safeSelect(selector, label) {
    await page.selectOption(selector, { label: label }).catch(async function() {
      await page.evaluate(function(sel) {
        var el = document.querySelector(sel)
        if (el && el.options.length > 1) el.selectedIndex = 1
      }, selector)
    })
    await page.waitForTimeout(300)
  }

  async function saveStep6FailureArtifacts(runId) {
    var dir = path.join('automation', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    var base = path.join(dir, 'step6-failure-' + runId + '-' + Date.now())
    await page.screenshot({ path: base + '.png', fullPage: true })
    fs.writeFileSync(base + '.html', await page.content())
    console.log('[results] failure artifacts saved: ' + base)
  }

  async function humanType(selector, value) {
    await page.click(selector)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(value, { delay: 75 })
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel)
      if (!el) return
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('blur', { bubbles: true }))
    }, selector)
    await page.waitForTimeout(200)
  }

  async function domMouseClick(selector) {
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel)
      if (!el) return
      var opts = { bubbles: true, cancelable: true, view: window }
      el.dispatchEvent(new MouseEvent('mousedown', opts))
      el.dispatchEvent(new MouseEvent('mouseup', opts))
      el.dispatchEvent(new MouseEvent('click', opts))
    }, selector)
  }

  async function logSearchClickDiagnostics(urlBefore) {
    await page.waitForTimeout(300)
    var urlAfter = page.url()
    var diag = await page.evaluate(function(sel) {
      var active = document.activeElement
      var btn = document.querySelector(sel)
      return {
        activeHtml: active ? active.outerHTML.substring(0, 300) : '(none)',
        btnHtml: btn ? btn.outerHTML.substring(0, 400) : '(none)',
        onclick: btn ? (btn.getAttribute('onclick') || '') : '',
        href: btn ? (btn.getAttribute('href') || '') : ''
      }
    }, config.selectors.addressSearchBtn).catch(function() { return {} })
    console.log('  URL before Search: ' + urlBefore)
    console.log('  URL after Search: ' + urlAfter)
    console.log('  Active element: ' + (diag.activeHtml || '(none)'))
    console.log('  Search button: ' + (diag.btnHtml || '(none)'))
    console.log('  Search onclick: ' + (diag.onclick || '(none)'))
    console.log('  Search href: ' + (diag.href || '(none)'))
  }

  async function blurSearchWithNeutralClick() {
    await page.waitForTimeout(2500)
    await page.mouse.click(20, 20)
    await page.waitForTimeout(500)
    await page.keyboard.press('Tab')
    console.log('  neutral page click sent after search')
    var afterBlur = await page.evaluate(function() {
      function isElVisible(el) {
        if (!el) return false
        var style = window.getComputedStyle(el)
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.offsetParent !== null
      }
      var active = document.activeElement
      var loadingVisible = isElVisible(document.getElementById('divLoadingTemplate'))
      var globalLoadingVisible = isElVisible(document.getElementById('divGlobalLoadingImg')) ||
        isElVisible(document.getElementById('divGlobalLoading'))
      var dialog = document.getElementById('dvACADialogLayer')
      var mask = document.getElementById('dvACADialogLayerMask')
      var modalVisible = false
      if (dialog) {
        var dialogStyle = window.getComputedStyle(dialog)
        modalVisible = dialogStyle.display !== 'none' &&
          !dialog.classList.contains('ACA_Hide') &&
          dialog.offsetHeight > 20
      }
      if (mask && mask.offsetParent !== null) modalVisible = true
      return {
        activeHtml: active ? active.outerHTML.substring(0, 300) : '(none)',
        spinnerModal: loadingVisible || globalLoadingVisible || modalVisible
      }
    }).catch(function() { return {} })
    console.log('  Active element after neutral click: ' + (afterBlur.activeHtml || '(none)'))
    console.log('  spinner/modal after neutral click: ' + !!(afterBlur.spinnerModal))
  }

  var SEARCH_POLL_SELS = {
    parcelNo: config.selectors.parcelNo,
    ownerName: config.selectors.ownerName,
    ownerAddress1: config.selectors.ownerAddress1,
    addressResult: config.selectors.addressResult,
    refAddressId: '#ctl00_PlaceHolderMain_WorkLocationEdit_txtRefAddressId'
  }

  function searchSuccessReason(state) {
    if (state.parcelVal) return 'parcel populated'
    if (state.ownerName || state.ownerAddress1) return 'owner section populated by portal'
    if (state.propertySectionUpdated) return 'property section updated by portal'
    if (state.resultRowCount > 0) return 'selectable address result row appeared'
    return null
  }

  function isPostbackQuiet(state) {
    if (state.spinnerVisible) return false
    if (state.asyncPostBack === null) return true
    return state.asyncPostBack === false
  }

  async function evaluateSearchPoll() {
    return page.evaluate(function(sels) {
      function fieldVal(sel) {
        var el = document.querySelector(sel)
        return el ? (el.value || '').trim() : ''
      }
      function isElVisible(el) {
        if (!el) return false
        var style = window.getComputedStyle(el)
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.offsetParent !== null
      }

      var parcelVal = fieldVal(sels.parcelNo)
      var ownerName = fieldVal(sels.ownerName)
      var ownerAddress1 = fieldVal(sels.ownerAddress1)
      var refAddressId = fieldVal(sels.refAddressId)

      var resultRowCount = 0
      document.querySelectorAll(sels.addressResult).forEach(function(row) {
        var text = row.innerText.trim()
        if (!text || /continue application/i.test(text)) return
        if (/^\d+/.test(text)) resultRowCount++
      })
      document.querySelectorAll('#dvACADialogLayer .ACA_Grid_Row').forEach(function(row) {
        var text = row.innerText.trim()
        if (!text || /continue application/i.test(text)) return
        if (/^\d+/.test(text)) resultRowCount++
      })

      var loadingVisible = isElVisible(document.getElementById('divLoadingTemplate'))
      var globalLoadingVisible = isElVisible(document.getElementById('divGlobalLoadingImg')) ||
        isElVisible(document.getElementById('divGlobalLoading'))
      var dialog = document.getElementById('dvACADialogLayer')
      var mask = document.getElementById('dvACADialogLayerMask')
      var modalVisible = false
      if (dialog) {
        var dialogStyle = window.getComputedStyle(dialog)
        modalVisible = dialogStyle.display !== 'none' &&
          !dialog.classList.contains('ACA_Hide') &&
          dialog.offsetHeight > 20
      }
      if (mask && mask.offsetParent !== null) modalVisible = true

      var asyncPostBack = null
      try {
        if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
          asyncPostBack = Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()
        }
      } catch (e) {}

      var hiddenErrors = []
      document.querySelectorAll(
        '.ACA_Error, .ACA_ErrorMessageLabel, .validation-summary-errors, ' +
        'span[style*="color:Red"], span[style*="color:red"]'
      ).forEach(function(el) {
        var t = (el.innerText || el.textContent || '').trim()
        if (t) hiddenErrors.push(t.substring(0, 200))
      })
      document.querySelectorAll('input[type="hidden"]').forEach(function(el) {
        var id = el.id || ''
        var name = el.name || ''
        if (/error|validation/i.test(id) || /error|validation/i.test(name)) {
          var v = (el.value || '').trim()
          if (v) hiddenErrors.push((id || name) + '=' + v.substring(0, 100))
        }
      })

      var alertTexts = []
      var bodyText = document.body ? document.body.innerText : ''
      var keywords = ['No records', 'No results', 'error', 'required', 'invalid']
      keywords.forEach(function(kw) {
        var re = new RegExp(kw.replace(/\s+/g, '\\s+'), 'i')
        if (re.test(bodyText)) {
          bodyText.split('\n').forEach(function(line) {
            var trimmed = line.trim()
            if (trimmed && re.test(trimmed)) alertTexts.push(trimmed.substring(0, 200))
          })
        }
      })
      alertTexts = alertTexts.filter(function(v, i, a) { return a.indexOf(v) === i }).slice(0, 5)
      hiddenErrors = hiddenErrors.filter(function(v, i, a) { return a.indexOf(v) === i }).slice(0, 5)

      return {
        parcelVal: parcelVal,
        ownerName: ownerName,
        ownerAddress1: ownerAddress1,
        propertySectionUpdated: !!refAddressId,
        resultRowCount: resultRowCount,
        loadingVisible: loadingVisible,
        globalLoadingVisible: globalLoadingVisible,
        modalVisible: modalVisible,
        spinnerVisible: loadingVisible || globalLoadingVisible || modalVisible,
        readyState: document.readyState,
        asyncPostBack: asyncPostBack,
        hiddenErrors: hiddenErrors,
        alertTexts: alertTexts
      }
    }, SEARCH_POLL_SELS).catch(function() { return {} })
  }

  function logSearchPoll(elapsed, state) {
    var ownerText = state.ownerName || state.ownerAddress1 || ''
    var asyncFlag = state.asyncPostBack === null ? 'n/a' : String(state.asyncPostBack)
    console.log(
      '  [poll ' + elapsed + 'ms] readyState=' + (state.readyState || '?') +
      ' asyncPostBack=' + asyncFlag +
      ' spinner/modal=' + !!state.spinnerVisible +
      ' parcel="' + (state.parcelVal || '') + '"' +
      ' resultRows=' + (state.resultRowCount || 0) +
      ' owner="' + ownerText + '"'
    )
    if (state.hiddenErrors && state.hiddenErrors.length) {
      console.log('  [poll ' + elapsed + 'ms] hiddenErrors: ' + state.hiddenErrors.join(' | '))
    }
    if (state.alertTexts && state.alertTexts.length) {
      console.log('  [poll ' + elapsed + 'ms] alertTexts: ' + state.alertTexts.join(' | '))
    }
  }

  async function isSpinnerVisible() {
    var state = await evaluateSearchPoll()
    return !!state.spinnerVisible
  }

  async function waitForSpinnerVisible(deadline) {
    if (await isSpinnerVisible()) return true
    while (Date.now() < deadline) {
      await page.waitForTimeout(200)
      if (await isSpinnerVisible()) return true
    }
    return false
  }

  async function waitForSpinnerHidden(deadline, searchWaitStart) {
    while (Date.now() < deadline) {
      var elapsed = Date.now() - searchWaitStart
      var state = await evaluateSearchPoll()
      logSearchPoll(elapsed, state)
      var reason = searchSuccessReason(state)
      if (reason) return { quiet: true, success: reason, state: state }
      if (isPostbackQuiet(state)) return { quiet: true, success: null, state: state }
      await page.waitForTimeout(500)
    }
    return { quiet: false, success: null, state: null }
  }

  async function waitForSpinnerCycle(deadline, searchWaitStart, cycleNum) {
    console.log('  [spinner cycle ' + cycleNum + '] waiting for visible...')
    var visible = await waitForSpinnerVisible(deadline)
    if (!visible) {
      console.log('  [spinner cycle ' + cycleNum + '] spinner never became visible within budget')
      return 'no_spinner'
    }
    console.log('  [spinner cycle ' + cycleNum + '] spinner visible, waiting for hidden + async quiet...')
    var result = await waitForSpinnerHidden(deadline, searchWaitStart)
    if (result.success) return result.success
    if (result.quiet) {
      console.log('  [spinner cycle ' + cycleNum + '] postback quiet, waiting 2s before DOM inspection...')
      await page.waitForTimeout(2000)
      var elapsed = Date.now() - searchWaitStart
      var state = await evaluateSearchPoll()
      logSearchPoll(elapsed, state)
      var reason = searchSuccessReason(state)
      if (reason) return reason
      return 'cycle_complete'
    }
    return 'timeout'
  }

  async function waitForSearchPostbackResponse() {
    var searchWaitStart = Date.now()
    var searchWaitMax = 90000
    var searchWaitReason = 'timeout'
    var deadline = searchWaitStart + searchWaitMax
    var postbackFinished = false
    var lastState = {}

    console.log('  Waiting 2s before ASP.NET postback monitoring...')
    await page.waitForTimeout(2000)

    console.log('  Monitoring up to 90s for ASP.NET partial postback lifecycle...')

    lastState = await evaluateSearchPoll()
    logSearchPoll(Date.now() - searchWaitStart, lastState)
    var reason = searchSuccessReason(lastState)
    if (reason) {
      console.log('  Wait finished in ' + (Date.now() - searchWaitStart) + 'ms — condition: ' + reason)
      return reason
    }

    var cycle1 = await waitForSpinnerCycle(deadline, searchWaitStart, 1)
    if (cycle1 && cycle1 !== 'cycle_complete' && cycle1 !== 'no_spinner' && cycle1 !== 'timeout') {
      console.log('  Wait finished in ' + (Date.now() - searchWaitStart) + 'ms — condition: ' + cycle1)
      return cycle1
    }
    if (cycle1 === 'cycle_complete') postbackFinished = true

    if (Date.now() < deadline) {
      if (cycle1 === 'cycle_complete') {
        console.log('  Pausing 1000ms before checking for second spinner cycle...')
        await page.waitForTimeout(1000)
      }
      if (await isSpinnerVisible()) {
        var cycle2 = await waitForSpinnerCycle(deadline, searchWaitStart, 2)
        if (cycle2 && cycle2 !== 'cycle_complete' && cycle2 !== 'no_spinner' && cycle2 !== 'timeout') {
          console.log('  Wait finished in ' + (Date.now() - searchWaitStart) + 'ms — condition: ' + cycle2)
          return cycle2
        }
        if (cycle2 === 'cycle_complete') postbackFinished = true
      }
    }

    while (Date.now() < deadline && !searchSuccessReason(lastState)) {
      var elapsed = Date.now() - searchWaitStart
      lastState = await evaluateSearchPoll()
      logSearchPoll(elapsed, lastState)
      reason = searchSuccessReason(lastState)
      if (reason) {
        searchWaitReason = reason
        break
      }
      if (isPostbackQuiet(lastState)) postbackFinished = true
      await page.waitForTimeout(500)
    }

    if (searchWaitReason === 'timeout') {
      reason = searchSuccessReason(lastState)
      if (reason) {
        searchWaitReason = reason
      } else if (postbackFinished && isPostbackQuiet(lastState)) {
        searchWaitReason = 'postback_finished_no_result'
      }
    }

    var searchWaitMs = Date.now() - searchWaitStart
    console.log('  Wait finished in ' + searchWaitMs + 'ms — condition: ' + searchWaitReason)
    if (searchWaitReason === 'postback_finished_no_result') {
      console.log('  Postback completed but parcel/owner/results did not populate.')
      if (lastState.alertTexts && lastState.alertTexts.length) {
        console.log('  Visible alert/error text: ' + lastState.alertTexts.join(' | '))
      }
      if (lastState.hiddenErrors && lastState.hiddenErrors.length) {
        console.log('  Hidden validation errors: ' + lastState.hiddenErrors.join(' | '))
      }
    } else if (searchWaitReason === 'timeout') {
      console.log(
        '  ASP.NET async postback may still be in progress (spinner=' +
        !!lastState.spinnerVisible + ' async=' +
        (lastState.asyncPostBack === null ? 'n/a' : String(lastState.asyncPostBack)) + ')'
      )
    }
    return searchWaitReason
  }

  async function performPortalLogin() {
    await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    var sessionOk = await isAccelaSessionValid(page)
    if (sessionOk) {
      console.log('[' + sessionProvider + '] Using saved session — skipping login ✓')
      return
    }
    console.log('[' + sessionProvider + '] Session expired or missing — logging in fresh')
    await clearSession(sessionProvider, companyId)
    await page.waitForTimeout(1500)
    var frameHandle = await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 15000 })
    var frame = await frameHandle.contentFrame()
    if (!frame) throw new Error('Login iframe not found after waiting')
    await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
    await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
    var result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
    await frame.evaluate(function(token) {
      document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function(el) {
        el.style.display = 'block'
        el.value = token
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
      var tryCallback = function(obj, token, depth) {
        depth = depth || 0
        if (depth > 5 || !obj) return
        try {
          if (typeof obj === 'object') {
            Object.keys(obj).forEach(function(key) {
              if (key === 'callback' && typeof obj[key] === 'function') obj[key](token)
              else tryCallback(obj[key], token, depth + 1)
            })
          }
        } catch(e) {}
      }
      if (window.___grecaptcha_cfg) tryCallback(window.___grecaptcha_cfg, token)
    }, result.data)
    await page.waitForTimeout(1500)
    await frame.evaluate(function() {
      document.querySelectorAll('button').forEach(function(b) {
        if (b.textContent.includes('Sign In')) b.click()
      })
    })
    await page.waitForURL('**/Dashboard.aspx**', { timeout: 15000 })
    await page.waitForTimeout(2000)
    console.log('[' + sessionProvider + '] Login complete — session will be saved for next run')
  }

  async function aspNetPostBack(eventTarget) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function() {}),
      page.evaluate(function(target) {
        var form = document.getElementById('aspnetForm') || document.forms[0]
        if (!form) throw new Error('aspnetForm missing')
        var et = form.querySelector('input[name="__EVENTTARGET"]')
        if (!et) {
          et = document.createElement('input')
          et.type = 'hidden'
          et.name = '__EVENTTARGET'
          form.appendChild(et)
        }
        et.value = target
        var ea = form.querySelector('input[name="__EVENTARGUMENT"]')
        if (!ea) {
          ea = document.createElement('input')
          ea.type = 'hidden'
          ea.name = '__EVENTARGUMENT'
          form.appendChild(ea)
        }
        ea.value = ''
        form.submit()
      }, eventTarget),
    ])
    await waitForPortalPostbackQuiet(page, 45000)
    await page.waitForTimeout(1500)
  }

  async function getWizardState() {
    return page.evaluate(function() {
      var body = document.body ? document.body.innerText : ''
      var headings = Array.from(document.querySelectorAll('h1, h2, h3, .ACA_Title_Bar, .ACA_SectionTitle'))
        .map(function(el) { return (el.innerText || '').replace(/\s+/g, ' ').trim() })
        .filter(Boolean)
        .slice(0, 30)
      var currentText = headings.join(' | ')
      var stepMatch = body.match(/Step\s*\d+\s*:\s*[^\n]+/i)
      var currentStepLine = stepMatch ? stepMatch[0].replace(/\s+/g, ' ').trim() : ''
      return {
        url: location.href,
        headings: headings,
        currentText: currentText,
        currentStepLine: currentStepLine,
        isReview: /Step\s*4\s*:\s*Review/i.test(currentStepLine) ||
          /(^|\|\s*)Review(\s*\||$)/i.test(currentText),
        isPayment: /Step\s*5\s*:\s*Pay Fees/i.test(currentStepLine) ||
          /Payment information|PAY NOW|CSG Forte/i.test(currentText + ' ' + body.slice(0, 1500)),
      }
    })
  }

  async function assertBeforePaymentBoundary() {
    var state = await getWizardState()
    if (state.isPayment || isPaymentBoundaryState(state.url, state.currentStepLine, state.currentText)) {
      throw Object.assign(
        new Error('Hard stop: Polk Phase 2 reached a Pay Fees or payment boundary'),
        { errorCode: 'payment_boundary_blocked' }
      )
    }
    return state
  }

  async function handleResumePageFlowModal() {
    var deadline = Date.now() + 45000
    var sawModal = false
    while (Date.now() < deadline) {
      var state = await page.evaluate(function() {
        var layer = document.getElementById('dvACADialogLayer')
        function visible(el) {
          if (!el) return false
          var style = window.getComputedStyle(el)
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            el.offsetHeight > 10 && !el.classList.contains('ACA_Hide')
        }
        var modalText = layer && visible(layer)
          ? (layer.innerText || '').replace(/\s+/g, ' ').trim()
          : ''
        return {
          capEdit: /CapEdit\.aspx/i.test(location.href),
          modal: visible(layer) && /Select Application Page Flow Step|Pick up where I left off/i.test(modalText),
        }
      })
      if (state.capEdit) return { skipped: true }
      if (state.modal) {
        sawModal = true
        break
      }
      await page.waitForTimeout(500)
    }
    if (!sawModal) {
      throw new Error('Resume page-flow modal (#dvACADialogLayer) was not detected after Resume Application')
    }

    var selected = await page.evaluate(function(choiceText) {
      var layer = document.getElementById('dvACADialogLayer')
      if (!layer) return false
      var target = Array.from(layer.querySelectorAll('input[type="radio"]')).find(function(radio) {
        var label = radio.id ? layer.querySelector('label[for="' + radio.id + '"]') : null
        var text = label ? label.innerText : ((radio.closest('td, tr, div') || {}).innerText || '')
        return text.replace(/\s+/g, ' ').trim() === choiceText
      })
      if (!target) return false
      target.checked = true
      target.click()
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, config.resumeApplication.defaultChoiceText)
    if (!selected) throw new Error('Could not select "' + config.resumeApplication.defaultChoiceText + '" in resume modal')

    var clickedOk = await page.evaluate(function(okText) {
      var layer = document.getElementById('dvACADialogLayer')
      if (!layer) return false
      var button = Array.from(layer.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
        .find(function(el) {
          return (el.innerText || el.value || '').replace(/\s+/g, ' ').trim() === okText
        })
      if (!button) return false
      button.click()
      return true
    }, config.resumeApplication.okText)
    if (!clickedOk) throw new Error('Could not click OK in resume page-flow modal')

    await page.waitForURL(/CapEdit\.aspx/i, { timeout: 45000 })
    await waitForPortalPostbackQuiet(page, 45000)
    await page.waitForTimeout(1500)
    return { skipped: false }
  }

  async function resumeExactDraft(portalRecordNumber) {
    await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(2000)
    var resumeTarget = await page.evaluate(function(recordNumber) {
      function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
      var expected = recordNumber.toUpperCase()
      var rows = Array.from(document.querySelectorAll('table[id$="gdvPermitList"] tr, tr.ACA_Grid_Row, tr'))
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (row.querySelector('table')) continue
        var text = clean(row.innerText)
        if (!text || text.toUpperCase().indexOf(expected) < 0) continue
        var exactToken = text.split(/\s+/).some(function(token) {
          return token.replace(/[,:;]+$/, '').toUpperCase() === expected
        })
        if (!exactToken) continue
        var control = Array.from(row.querySelectorAll('a, button')).find(function(el) {
          return /resume\s+application/i.test(clean(el.innerText || el.title || el.value))
        })
        if (!control) continue
        var href = control.getAttribute('href') || ''
        var match = href.match(/__doPostBack\('([^']+)'/)
        return {
          controlId: control.id || null,
          postTarget: match ? match[1].replace(/\\'/g, "'") : null,
        }
      }
      return null
    }, portalRecordNumber)

    if (!resumeTarget) throw new Error('Exact portal_record_number was not found with a Resume Application control')
    if (resumeTarget.postTarget) {
      await aspNetPostBack(resumeTarget.postTarget)
    } else if (resumeTarget.controlId) {
      await page.locator('#' + resumeTarget.controlId).click({ force: true })
    } else {
      throw new Error('Resume Application control did not expose a safe click target')
    }

    await handleResumePageFlowModal()
    if (!/CapEdit\.aspx/i.test(page.url())) throw new Error('Resume did not land on the CapEdit wizard')
    var state = await assertBeforePaymentBoundary()
    var wizardVisible = await page.locator(
      config.selectors.streetNo + ', ' +
      config.selectors.workType + ', ' +
      config.selectors.jobDescription + ', ' +
      config.selectors.planUploadAcknowledgement
    ).count()
    if (!wizardVisible && !state.isReview) throw new Error('Resume reached CapEdit but no verified wizard surface was found')
  }

  async function fillTextExact(selector, value, fieldName) {
    var locator = page.locator(selector).first()
    await locator.waitFor({ state: 'visible', timeout: 15000 })
    await locator.fill(String(value))
    var actual = await locator.inputValue()
    if (actual.trim() !== String(value).trim()) throw new Error(fieldName + ' did not retain the expected value')
  }

  async function clearIfPresent(selector) {
    var locator = page.locator(selector).first()
    if (await locator.count()) await locator.fill('')
  }

  async function selectExactLabel(selector, label, fieldName) {
    var locator = page.locator(selector).first()
    await locator.waitFor({ state: 'visible', timeout: 15000 })
    await locator.selectOption({ label: label })
    var actual = await locator.locator('option:checked').textContent()
    if (String(actual || '').trim() !== label) throw new Error(fieldName + ' did not select "' + label + '"')
  }

  async function setChecked(selector, checked, fieldName) {
    var locator = page.locator(selector).first()
    await locator.waitFor({ state: 'visible', timeout: 15000 })
    if (checked) await locator.check()
    else await locator.uncheck()
    if (await locator.isChecked() !== checked) throw new Error(fieldName + ' did not retain the expected checked state')
  }

  async function setRadio(yesSelector, noSelector, yes, fieldName) {
    var selector = yes ? yesSelector : noSelector
    var locator = page.locator(selector).first()
    await locator.waitFor({ state: 'visible', timeout: 15000 })
    await locator.check()
    if (!(await locator.isChecked())) throw new Error(fieldName + ' did not retain the expected choice')
  }

  async function continueUntil(targetSelector, targetName, maxAdvances) {
    for (var advance = 0; advance <= maxAdvances; advance++) {
      if (await page.locator(targetSelector).first().isVisible().catch(function() { return false })) return
      var state = await assertBeforePaymentBoundary()
      if (state.isReview) throw new Error('Hard stop: refused to Continue from Review while seeking ' + targetName)
      var continueButton = page.locator(config.selectors.continueBtn).first()
      if (!(await continueButton.count())) throw new Error('Continue Application control missing before ' + targetName)
      await continueButton.waitFor({ state: 'visible', timeout: 15000 })
      await continueButton.click()
      await waitForPortalPostbackQuiet(page, 45000)
      await page.waitForTimeout(1200)
    }
    throw new Error('Could not reach ' + targetName + ' within the guarded wizard advance limit')
  }

  async function continueUntilReview(maxAdvances) {
    for (var advance = 0; advance <= maxAdvances; advance++) {
      var state = await assertBeforePaymentBoundary()
      if (state.isReview) return state
      var continueButton = page.locator(config.selectors.continueBtn).first()
      if (!(await continueButton.count())) throw new Error('Continue Application control missing before Review')
      await continueButton.waitFor({ state: 'visible', timeout: 15000 })
      await continueButton.click()
      await waitForPortalPostbackQuiet(page, 45000)
      await page.waitForTimeout(1200)
    }
    throw new Error('Could not reach Review within the guarded wizard advance limit')
  }

  async function captureSanitizedReviewSummary() {
    var raw = await page.evaluate(function() {
      function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
      var sections = Array.from(document.querySelectorAll('h1, h2, h3, .ACA_Title_Bar, .ACA_SectionTitle'))
        .map(function(el) { return clean(el.innerText) })
        .filter(Boolean)
        .slice(0, 40)
      var fields = []
      document.querySelectorAll('tr').forEach(function(row) {
        var cells = Array.from(row.querySelectorAll(':scope > td')).map(function(cell) { return clean(cell.innerText) }).filter(Boolean)
        if (cells.length < 2) return
        fields.push({ label: cells[0].slice(0, 160), value: cells.slice(1).join(' | ').slice(0, 500) })
      })
      return { url: location.href, sections: sections, fields: fields.slice(0, 250) }
    })
    var seen = {}
    return {
      capturedAt: new Date().toISOString(),
      sections: raw.sections,
      fields: raw.fields.filter(function(field) {
        var key = field.label + '|' + field.value
        if (seen[key]) return false
        seen[key] = true
        return true
      }).map(function(field) {
        return { label: field.label, value: redactReviewValue(field.label, field.value) }
      }),
    }
  }

  async function runBootstrapStep(step, name, fn, checkpointData) {
    var recoveringPastStep = startFromStep >= step
    return logStep(page, runId, step, name, fn, checkpointData, recoveringPastStep
      ? { alwaysRun: true, preserveCheckpoint: true }
      : undefined)
  }

  /**
   * Phase B — Post-submit attachments upload.
   * Requires explicit portal_record_number (submitted Accela alt ID).
   * Does not use jobs.permit_number (that is set only after Mark Permit Issued).
   * Fail-closed on missing docs and unconfirmed upload selectors.
   */
  async function runPolkDocumentUpload() {
    var supabase = getSupabase()
    var uploadPlan = await resolvePostSubmitUploadPlan(supabase, jobData)
    var attachmentCfg = config.postSubmitAttachments || {}
    var uploadResults = []

    async function assertDocumentUploadSurface(label) {
      var state = await assertBeforePaymentBoundary()
      var pageText = state.currentText || ''
      if (!isPostSubmitAttachmentSurface(state.url, pageText + ' ' + (state.currentStepLine || ''))) {
        // CapDetail/AttachmentsList may not match isPayment; still reject CapEdit/cart.
        if (/CapEdit\.aspx|ShoppingCart\.aspx|Pay Fees|CSG Forte/i.test(state.url + ' ' + pageText)) {
          throw Object.assign(
            new Error('Hard stop: permit_document_upload reached CapEdit/payment surface (' + label + ')'),
            { errorCode: 'payment_boundary_blocked' }
          )
        }
      }
      if (/CapEdit\.aspx/i.test(state.url)) {
        throw Object.assign(
          new Error('Hard stop: permit_document_upload must open CapDetail/AttachmentsList, not CapEdit'),
          { errorCode: 'payment_boundary_blocked' }
        )
      }
      return state
    }

    async function openSubmittedRecordCapDetail(portalRecordNumber) {
      await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(2000)
      var opened = await page.evaluate(function (recordNumber) {
        function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
        var expected = recordNumber.toUpperCase()
        var rows = Array.from(document.querySelectorAll('table[id$="gdvPermitList"] tr, tr.ACA_Grid_Row, tr'))
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          if (row.querySelector('table')) continue
          var text = clean(row.innerText)
          if (!text) continue
          // Exact token match (same discipline as resumeExactDraft) — avoids
          // 26TMP-04376 falsely matching a row that shows 26TMP-043760.
          var exactToken = text.split(/\s+/).some(function (token) {
            return token.replace(/[,:;]+$/, '').toUpperCase() === expected
          })
          if (!exactToken) continue
          // Prefer a CapDetail / Record Number link — never Resume Application (draft path).
          var links = Array.from(row.querySelectorAll('a'))
          var detail = links.find(function (a) {
            var href = String(a.getAttribute('href') || '')
            var label = clean(a.innerText)
            if (/Resume Application/i.test(label)) return false
            return /CapDetail\.aspx/i.test(href) || label.toUpperCase() === expected || /View|Detail|Record/i.test(label)
          })
          if (!detail) {
            detail = links.find(function (a) {
              return !/Resume Application/i.test(clean(a.innerText))
            })
          }
          if (!detail) return { ok: false, reason: 'no_capdetail_link' }
          detail.click()
          return { ok: true }
        }
        return { ok: false, reason: 'record_not_found' }
      }, portalRecordNumber)

      if (!opened || !opened.ok) {
        throw Object.assign(
          new Error(
            'Exact portal_record_number was not found as a submitted CapDetail record (' +
            ((opened && opened.reason) || 'unknown') + ')'
          ),
          { errorCode: 'portal_record_not_found' }
        )
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(function () {})
      await page.waitForTimeout(2000)
      await assertDocumentUploadSurface('after_open_record')
    }

    async function downloadJobDocumentToTemp(item) {
      var { data, error } = await supabase.storage.from('job-documents').download(item.filePath)
      if (error || !data) {
        throw new Error('Could not download job document ' + item.role + ': ' + (error && error.message))
      }
      var buf = Buffer.from(await data.arrayBuffer())
      var safeName = String(item.fileName || item.role + '.pdf').replace(/[^\w.\-]+/g, '_')
      var tmpPath = path.join(os.tmpdir(), 'dartiq-polk-upload-' + runId + '-' + item.role + '-' + safeName)
      fs.writeFileSync(tmpPath, buf)
      return tmpPath
    }

    async function uploadOneDocument(item, index) {
      var tmpPath = null
      var stepName = 'document_upload_' + item.role
      try {
        await assertDocumentUploadSurface('before_upload_' + item.role)
        tmpPath = await downloadJobDocumentToTemp(item)
        var fileInputSel = attachmentCfg.selectors.fileInput
        var browseSel = attachmentCfg.selectors.browseAdd
        var input = page.locator(fileInputSel).first()
        var inputCount = await input.count()
        if (inputCount === 0 && browseSel) {
          await page.locator(browseSel).first().click({ timeout: 10000 }).catch(function () {})
          await page.waitForTimeout(1000)
        }
        await page.setInputFiles(fileInputSel, tmpPath)
        await page.waitForTimeout(2000)
        await assertDocumentUploadSurface('after_upload_' + item.role)

        assertSupabaseOk(await supabase.from('automation_logs').insert({
          run_id: runId,
          step_number: 10 + index,
          step_name: stepName,
          success: true,
          notes: JSON.stringify({
            role: item.role,
            documentId: item.documentId,
            fileName: item.fileName,
            portalRecordNumber: runContract.portalRecordNumber,
          }),
          logged_at: new Date().toISOString(),
        }), 'Log successful document upload')

        uploadResults.push({ role: item.role, success: true })
      } catch (uploadErr) {
        assertSupabaseOk(await supabase.from('automation_logs').insert({
          run_id: runId,
          step_number: 10 + index,
          step_name: stepName,
          success: false,
          notes: JSON.stringify({
            role: item.role,
            documentId: item.documentId,
            error: uploadErr.message,
            errorCode: uploadErr.errorCode || null,
          }),
          raw_error: uploadErr.stack || '',
          logged_at: new Date().toISOString(),
        }), 'Log failed document upload')
        uploadResults.push({ role: item.role, success: false, error: uploadErr.message })
        throw uploadErr
      } finally {
        if (tmpPath) {
          try { fs.unlinkSync(tmpPath) } catch (e) {}
        }
      }
    }

    await runBootstrapStep(1, 'doc_upload_login', performPortalLogin, { bootstrap: true })
    await runBootstrapStep(2, 'doc_upload_open_record', async function () {
      await openSubmittedRecordCapDetail(runContract.portalRecordNumber)
    }, { exactRecordFromCurrentRunPayload: true })

    await logStep(page, runId, 3, 'doc_upload_open_attachments', async function () {
      await assertDocumentUploadSurface('before_attachments_tab')
      var tabSel = (attachmentCfg.selectors && attachmentCfg.selectors.attachmentsTab) ||
        'a[data-control="tab-attachments"]'
      var tab = page.locator(tabSel).first()
      if (await tab.count()) {
        await tab.click({ timeout: 15000 })
        await page.waitForTimeout(2000)
      }
      // AttachmentsList may open in same frame or navigate.
      await page.waitForTimeout(1000)
      await assertDocumentUploadSurface('after_attachments_tab')
    }, { portalRecordNumber: runContract.portalRecordNumber })

    await logStep(page, runId, 4, 'doc_upload_selector_gate', async function () {
      // Fail closed before any setInputFiles if discovery has not confirmed selectors.
      assertUploadSelectorsConfirmed(config)
      await assertDocumentUploadSurface('selector_gate')
    }, {
      confirmedForRoofingPermit: !!(attachmentCfg && attachmentCfg.confirmedForRoofingPermit),
    })

    for (var i = 0; i < uploadPlan.items.length; i++) {
      await logStep(page, runId, 5 + i, 'doc_upload_' + uploadPlan.items[i].role, async function () {
        await uploadOneDocument(uploadPlan.items[i], i)
      }, { role: uploadPlan.items[i].role })
    }

    await logStep(page, runId, 20, 'doc_upload_complete', async function () {
      await assertDocumentUploadSurface('complete')
      var summary = {
        portalRecordNumber: runContract.portalRecordNumber,
        uploaded: uploadResults,
        requiredRoles: uploadPlan.items.map(function (it) { return it.role }),
        humanApprovalRequired: false,
        markPermitIssuedNotPerformed: true,
        awaitingCountyReview: true,
      }
      var fullScreenshotPath = 'runs/' + runId + '/document-upload-complete.png'
      var fullScreenshot = await page.screenshot({ fullPage: true, type: 'png' })
      assertSupabaseOk(await supabase.storage.from('screenshots').upload(fullScreenshotPath, fullScreenshot, {
        contentType: 'image/png',
        upsert: true,
      }), 'Upload document-upload completion screenshot')

      assertSupabaseOk(await supabase.from('automation_logs').insert({
        run_id: runId,
        step_number: 20,
        step_name: 'document_upload_complete',
        success: true,
        screenshot_path: fullScreenshotPath,
        notes: JSON.stringify(summary),
        logged_at: new Date().toISOString(),
      }), 'Write document upload summary to automation_logs')

      var actionResult = await logRunAction({
        runId: runId,
        jobId: jobData.id,
        companyId: jobData.company_id,
        action: 'document_upload_complete',
        status: 'success',
        stepNumber: 20,
        stepName: 'document_upload_complete',
        screenshotPath: fullScreenshotPath,
        portalResponse: 'Required post-submit documents uploaded; awaiting county review',
        metadata: summary,
      })
      if (!actionResult.ok) {
        throw new Error('Could not write document upload summary to run_actions: ' + actionResult.error)
      }

      assertSupabaseOk(await supabase.from('automation_runs').update({
        run_status: RUN_STATUS_DOCUMENT_UPLOAD,
        completed_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', runId), 'Mark document upload run complete')

      // Existing status: submitted = filed with county, awaiting review. Do not invent a new status.
      assertSupabaseOk(await supabase.from('jobs').update({
        job_status: 'submitted',
      }).eq('id', jobData.id), 'Mark job submitted after document upload')
    }, { uploadResults: uploadResults })

    console.log('POLK DOCUMENT UPLOAD COMPLETE — AWAITING COUNTY REVIEW')
    return { status: 'needs_review', stoppedAt: 'document_upload_complete', uploadResults: uploadResults }
  }

  async function runPolkPhase2() {
    var supabase = getSupabase()
    var locationCheckpoint = { fields: [] }
    var detailCheckpoint = { fields: [] }
    var documentCheckpoint = { fields: [] }
    var reviewCheckpoint = { stoppedAt: 'review', humanApprovalRequired: true }

    await runBootstrapStep(1, 'phase2_login', performPortalLogin, { bootstrap: true })
    await runBootstrapStep(2, 'phase2_resume_draft', async function() {
      await resumeExactDraft(runContract.portalRecordNumber)
    }, { exactRecordFromCurrentRunPayload: true })

    await logStep(page, runId, 3, 'phase2_location_people', async function() {
      await continueUntil(config.selectors.workType, 'Location & People permit information', 4)
      await setRadio(config.selectors.gateAccessYes, config.selectors.gateAccessNo, phase2Values.gateCodeRequired, 'Gate Code')
      if (phase2Values.gateCodeRequired) await fillTextExact(config.selectors.gateCode, phase2Values.gateCode, 'Gate Code value')
      else await clearIfPresent(config.selectors.gateCode)
      await setRadio(config.selectors.codeViolationYes, config.selectors.codeViolationNo, phase2Values.codeViolation, 'Code Violation')
      if (phase2Values.codeViolation) {
        await fillTextExact(config.selectors.codeViolationCaseNumber, phase2Values.codeViolationCaseNumber, 'Code Violation case number')
      } else {
        await clearIfPresent(config.selectors.codeViolationCaseNumber)
      }
      await setRadio(config.selectors.applicantOwnerYes, config.selectors.applicantOwnerNo, false, 'Applicant is Owner')
      // Construction Waste intentionally left unset (config.fieldFillPolicy.leaveUnset).
      await setRadio(config.selectors.virtualInspectionYes, config.selectors.virtualInspectionNo, false, 'Virtual Inspections')
      await setRadio(config.selectors.privateProviderYes, config.selectors.privateProviderNo, false, 'Private Provider')
      await selectExactLabel(config.selectors.packetSubmission, phase2Values.packetSubmission, 'Packet Submission')
      await selectExactLabel(config.selectors.fs119Status, phase2Values.fs119Status, 'FS 119 Status')
      await selectExactLabel(config.selectors.workType, phase2Values.workType, 'Work Type')
      await selectExactLabel(config.selectors.propertyType, phase2Values.propertyType, 'Property Type')
      await selectExactLabel(config.selectors.reroofPermitType, phase2Values.reroofPermitType, 'Reroof Permit Type')
      await fillTextExact(config.selectors.numberOfSquares, phase2Values.numberOfSquares, 'Number of Squares')
      await selectExactLabel(config.selectors.roofType, phase2Values.roofType, 'Roof Type')
      await setChecked(config.selectors.reroofAffidavit, true, 'Reroof affidavit')
      await setChecked(config.selectors.asbestosStatement, true, 'Asbestos statement')
      await clearIfPresent(config.selectors.commercialFranchiseHolderName)
      await clearIfPresent(config.selectors.commercialFranchiseHolderPhone)
      await clearIfPresent(config.selectors.disposalEquipment)
      await clearIfPresent(config.selectors.disposalFrequency)
      locationCheckpoint.fields = [
        'gateCode', 'codeViolation', 'applicantIsOwner', 'virtualInspections',
        'privateProvider', 'packetSubmission', 'fs119Status', 'workType',
        'propertyType', 'reroofPermitType', 'numberOfSquares', 'roofType',
        'reroofAffidavit', 'asbestosStatement',
      ]
    }, locationCheckpoint)

    await logStep(page, runId, 4, 'phase2_permit_detail', async function() {
      await continueUntil(config.selectors.jobDescription, 'Permit Detail', 5)
      await fillTextExact(config.selectors.jobDescription, phase2Values.jobDescription, 'Job Description')
      await fillTextExact(config.selectors.jobValue, phase2Values.jobValue, 'Job Value')
      detailCheckpoint.fields = ['jobDescription', 'jobValue']
    }, detailCheckpoint)

    await logStep(page, runId, 5, 'phase2_documents_acknowledgement', async function() {
      await continueUntil(config.selectors.planUploadAcknowledgement, 'Documents acknowledgement', 4)
      await setChecked(config.selectors.planUploadAcknowledgement, true, 'Plan Upload Acknowledgement')
      documentCheckpoint.fields = ['planUploadAcknowledgement']
      documentCheckpoint.uploadAttempted = false
    }, documentCheckpoint)

    await logStep(page, runId, 6, 'phase2_review_hard_stop', async function() {
      var reviewState = await continueUntilReview(3)
      if (!reviewState.isReview) throw new Error('Review screen was not positively confirmed')
      await assertBeforePaymentBoundary()

      var summary = await captureSanitizedReviewSummary()
      var fullScreenshotPath = 'runs/' + runId + '/phase2-review-full.png'
      var fullScreenshot = await page.screenshot({ fullPage: true, type: 'png' })
      assertSupabaseOk(await supabase.storage.from('screenshots').upload(fullScreenshotPath, fullScreenshot, {
        contentType: 'image/png',
        upsert: true,
      }), 'Upload full Polk Review screenshot')

      assertSupabaseOk(await supabase.from('automation_logs').insert({
        run_id: runId,
        step_number: 6,
        step_name: 'phase2_review_hard_stop',
        success: true,
        screenshot_path: fullScreenshotPath,
        notes: JSON.stringify(summary),
        logged_at: new Date().toISOString(),
      }), 'Write Polk Review summary to automation_logs')

      var actionResult = await logRunAction({
        runId: runId,
        jobId: jobData.id,
        companyId: jobData.company_id,
        action: 'phase2_review_ready',
        status: 'success',
        stepNumber: 6,
        stepName: 'phase2_review_hard_stop',
        screenshotPath: fullScreenshotPath,
        portalResponse: 'Review screen loaded; automation stopped before Continue Application',
        metadata: {
          reviewSummary: summary,
          humanApprovalRequired: true,
          paymentReached: false,
          documentUploadAttempted: false,
        },
      })
      if (!actionResult.ok) throw new Error('Could not write Polk Review summary to run_actions: ' + actionResult.error)

      assertSupabaseOk(await supabase.from('automation_runs').update({
        run_status: RUN_STATUS_PHASE2_REVIEW,
        completed_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', runId), 'Mark Polk Phase 2 run needs_review')
      assertSupabaseOk(await supabase.from('jobs').update({
        job_status: 'needs_review',
      }).eq('id', jobData.id), 'Mark Polk Phase 2 job needs_review')

      reviewCheckpoint.screenshotPath = fullScreenshotPath
      reviewCheckpoint.reviewFieldCount = summary.fields.length
    }, reviewCheckpoint)

    console.log('POLK PHASE 2 COMPLETE — STOPPED AT REVIEW FOR HUMAN APPROVAL')
    return { status: 'needs_review', stoppedAt: 'review' }
  }

  var resume = await logRecoveryStart(runId)
  var startFromStep = resume.isResume ? resume.stepNumber : 0
  console.log('[recovery] Starting from step:', startFromStep)

  try {
    if (runContract.runType === 'permit_document_upload') {
      return await runPolkDocumentUpload()
    }
    if (runContract.runType === 'permit_resume') {
      return await runPolkPhase2()
    }

    // Step 1 — Login (reuse saved browser session when still valid)
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    await logStep(page, runId, stepNumber, 'login', async function() {
      await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      var sessionOk = await isAccelaSessionValid(page)
      if (sessionOk) {
        console.log('[' + sessionProvider + '] Using saved session — skipping login ✓')
        return
      }
      console.log('[' + sessionProvider + '] Session expired or missing — logging in fresh')
      await clearSession(sessionProvider, companyId)
      await page.waitForTimeout(1500)
      var frameHandle = await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 15000 })
      var frame = await frameHandle.contentFrame()
      if (!frame) throw new Error('Login iframe not found after waiting')
      await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
      await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
      var result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
      await frame.evaluate(function(token) {
        document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function(el) {
          el.style.display = 'block'
          el.value = token
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        })
        var tryCallback = function(obj, token, depth) {
          depth = depth || 0
          if (depth > 5 || !obj) return
          try {
            if (typeof obj === 'object') {
              Object.keys(obj).forEach(function(key) {
                if (key === 'callback' && typeof obj[key] === 'function') obj[key](token)
                else tryCallback(obj[key], token, depth + 1)
              })
            }
          } catch(e) {}
        }
        if (window.___grecaptcha_cfg) tryCallback(window.___grecaptcha_cfg, token)
      }, result.data)
      await page.waitForTimeout(1500)
      await frame.evaluate(function() {
        document.querySelectorAll('button').forEach(function(b) {
          if (b.textContent.includes('Sign In')) b.click()
        })
      })
      await page.waitForURL('**/Dashboard.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
      console.log('[' + sessionProvider + '] Login complete — session will be saved for next run')
    })
    }

    // Step 2 — Navigate to disclaimer
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    await logStep(page, runId, stepNumber, 'navigate_to_disclaimer', async function() {
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    })
    }

    // Step 3 — Accept disclaimer
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    await logStep(page, runId, stepNumber, 'accept_disclaimer', async function() {
      await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })
    }

    // Step 4 — Select Re-Roof permit type
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    await logStep(page, runId, stepNumber, 'select_reroof_permit', async function() {
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })
    }

    // Step 5 — Fill address search with parsed components
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    var step5Checkpoint = {}
    await logStep(page, runId, stepNumber, 'fill_address_search', async function() {
      var parsed = parseAddress(jobData.property_address)
      var streetName = parsed.streetName.toUpperCase()
      var city = jobData.property_city ? jobData.property_city.toUpperCase() : ''
      var suffixLabel = parsed.suffix ? parsed.suffix.toUpperCase() : null
      console.log('  Street number: ' + parsed.streetNo)
      console.log('  Street name: ' + streetName)
      console.log('  Suffix: ' + (suffixLabel || 'none'))

      await humanType(config.selectors.streetNo, parsed.streetNo)
      await humanType(config.selectors.streetName, streetName)

      if (suffixLabel && config.selectors.streetType) {
        await page.selectOption(config.selectors.streetType, { label: suffixLabel })
          .catch(async function() {
            await page.evaluate(function(args) {
              var el = document.querySelector(args.sel)
              if (el) {
                var opt = Array.from(el.options).find(function(o) {
                  return o.text.toUpperCase().includes(args.suffix)
                })
                if (opt) {
                  el.value = opt.value
                  el.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }
            }, { sel: config.selectors.streetType, suffix: suffixLabel })
          })
        console.log('  Suffix filled: ' + suffixLabel)
      }

      if (city) {
        await humanType(config.selectors.city, city)
        console.log('  City filled: ' + city)
      }
      if (jobData.property_zip) {
        await humanType(config.selectors.zip, jobData.property_zip)
        console.log('  Zip filled: ' + jobData.property_zip)
        await page.keyboard.press('Tab')
        await page.waitForTimeout(1000)
      }

      await page.waitForTimeout(500)
      var urlBeforeSearch = page.url()
      await domMouseClick(config.selectors.addressSearchBtn)
      await logSearchClickDiagnostics(urlBeforeSearch)
      await blurSearchWithNeutralClick()

      var searchWaitReason = await waitForSearchPostbackResponse()
      var parcelAfterWait = await page.$eval(
        config.selectors.parcelNo,
        function(el) { return (el.value || '').trim() }
      ).catch(function() { return '' })
      console.log('  Parcel value: ' + (parcelAfterWait || '(empty)'))
      if (searchWaitReason === 'postback_finished_no_result' || searchWaitReason === 'timeout') {
        console.log('  Step 5 search did not populate parcel — continuing to Step 6 for grid fallback.')
      }
      step5Checkpoint.parcel = parcelAfterWait || ''
    }, step5Checkpoint)
    }

    // Step 6 — Select address result
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    var step6Checkpoint = {}
    await logStep(page, runId, stepNumber, 'select_address_result', async function() {
      await removeOverlay()

      async function readAddressFields() {
        var parcel = await page.$eval(
          config.selectors.parcelNo,
          function(el) { return (el.value || '').trim() }
        ).catch(function() { return '' })
        var cityVal = await page.$eval(
          config.selectors.city,
          function(el) { return (el.value || '').trim() }
        ).catch(function() { return '' })
        var zipVal = await page.$eval(
          config.selectors.zip,
          function(el) { return (el.value || '').trim() }
        ).catch(function() { return '' })
        return { parcel: parcel, city: cityVal, zip: zipVal }
      }

      var fields = await readAddressFields()

      if (fields.parcel) {
        console.log('[results] auto-fill detected: true')
        console.log('[results] parcel: ' + fields.parcel + ', city: ' + fields.city + ', zip: ' + fields.zip)
        console.log('  Address selected — portal populating fields...')
        step6Checkpoint.parcel = fields.parcel
        var ownerEarly = await page.$eval(
          config.selectors.ownerName,
          function(el) { return el.value || el.innerText || '' }
        ).catch(function() { return '' })
        step6Checkpoint.owner = (ownerEarly || '').trim()
        return
      }

      if (fields.city && fields.zip) {
        console.log('[results] city+zip populated but parcel empty — waiting for parcel...')
        for (var parcelAttempt = 0; parcelAttempt < 10; parcelAttempt++) {
          await page.waitForTimeout(500)
          fields = await readAddressFields()
          if (fields.parcel) break
        }
      }

      if (fields.parcel) {
        console.log('[results] auto-fill detected: true')
        console.log('[results] parcel: ' + fields.parcel + ', city: ' + fields.city + ', zip: ' + fields.zip)
        console.log('  Address selected — portal populating fields...')
        step6Checkpoint.parcel = fields.parcel
        var ownerRetry = await page.$eval(
          config.selectors.ownerName,
          function(el) { return el.value || el.innerText || '' }
        ).catch(function() { return '' })
        step6Checkpoint.owner = (ownerRetry || '').trim()
        return
      }

      console.log('[results] auto-fill detected: false — parcel still empty')
      var rowSelector = config.selectors.addressResult
      console.log('[results] attempting grid selection')
      console.log('[results] selector used: ' + rowSelector)

      try {
        await page.waitForSelector(rowSelector, { timeout: 10000 })
      } catch (waitErr) {
        await saveStep6FailureArtifacts(runId)
        throw Object.assign(
          new Error('Parcel number not populated and address results grid did not appear: ' + jobData.property_address),
          { errorCode: 'validation_failed' }
        )
      }

      var rawRows = await page.$$eval(rowSelector, function(rows) {
        return rows.map(function(row) { return row.innerText.trim() })
      }).catch(function() { return [] })
      rawRows.forEach(function(text, i) {
        console.log('[results] raw row text [' + i + ']: "' + text + '"')
      })

      var matchedRows = await page.$$eval(rowSelector, function(rows) {
        return rows.map(function(row, i) {
          return { index: i, text: row.innerText.trim() }
        }).filter(function(r) {
          if (!r.text) return false
          if (/continue application/i.test(r.text)) return false
          return /^\d+/.test(r.text)
        })
      }).catch(function() { return [] })

      if (matchedRows.length === 0) {
        await saveStep6FailureArtifacts(runId)
        throw Object.assign(
          new Error('Parcel number not populated and address not found in portal: ' + jobData.property_address),
          { errorCode: 'validation_failed' }
        )
      }

      var matched = matchedRows[0]
      console.log('[results] matched row [' + matched.index + ']: "' + matched.text + '"')

      var resultRows = await page.$$(rowSelector)
      var targetRow = resultRows[matched.index]
      await targetRow.evaluate(function(row) {
        var link = row.querySelector('a')
        var target = link || row
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })

      console.log('[results] clicked row [' + matched.index + ']: "' + matched.text + '"')

      await page.waitForTimeout(5000)
      await removeOverlay()

      fields = await readAddressFields()
      if (!fields.parcel) {
        await saveStep6FailureArtifacts(runId)
        throw Object.assign(
          new Error('Parcel number not populated after address selection: ' + jobData.property_address),
          { errorCode: 'validation_failed' }
        )
      }

      console.log('[results] parcel populated after grid selection: ' + fields.parcel)
      console.log('  Address selected — portal populating fields...')
      step6Checkpoint.parcel = fields.parcel
      var ownerGrid = await page.$eval(
        config.selectors.ownerName,
        function(el) { return el.value || el.innerText || '' }
      ).catch(function() { return '' })
      step6Checkpoint.owner = (ownerGrid || '').trim()
    }, step6Checkpoint)
    }

    // Step 7 — Phase 1 stop point
    stepNumber++
    if (!(await shouldSkipStep(runId, stepNumber))) {
    var step7Checkpoint = {}
    await logStep(page, runId, stepNumber, 'phase1_save_parcel_and_stop', async function() {
      var supabase = getSupabase()
      await page.waitForTimeout(2000)

      var allInputs = await page.$$eval('input[type="text"], input:not([type])', function(els) {
        return els.map(function(el) {
          return { id: el.id, name: el.name, value: el.value }
        }).filter(function(el) { return el.value && el.value.trim().length > 0 })
      }).catch(function() { return [] })
      console.log('  Populated fields (' + allInputs.length + '):')
      allInputs.forEach(function(el) {
        console.log('    #' + el.id + ' value="' + el.value + '"')
      })

      var parcelNumber = await page.$eval(
        config.selectors.parcelNo,
        function(el) { return el.value || el.innerText || '' }
      ).catch(function() { return '' })

      var portalOwnerName = await page.$eval(
        config.selectors.ownerName,
        function(el) { return el.value || el.innerText || '' }
      ).catch(function() { return '' })

      console.log('  Parcel raw value: "' + parcelNumber + '"')
      console.log('  Owner raw value: "' + portalOwnerName + '"')

      if (!parcelNumber || parcelNumber.trim() === '') {
        console.log('  Parcel not found — marking needs_review')
        assertSupabaseOk(await supabase.from('automation_runs').update({
          run_status: 'needs_review',
          error_message: 'Parcel number not populated. Check address format and dropdown selection.',
          completed_at: new Date().toISOString(),
        }).eq('id', runId), 'Mark automation run needs_review')
        assertSupabaseOk(await supabase.from('jobs').update({ job_status: 'needs_review' }).eq('id', jobData.id), 'Mark job needs_review')
        return
      }

      console.log('  Resolving legal description...')
      var legalSelectors = {
        legalDescription: config.selectors.legalDescription,
        lot: config.selectors.parcelLot,
        block: config.selectors.parcelBlock,
        tract: config.selectors.parcelTract,
        subdivision: config.selectors.parcelSubdivision,
        parcelSearchBtn: config.selectors.parcelSearchBtn,
      }
      var legalResult = await resolveLegalDescription(
        page,
        parcelNumber.trim(),
        legalSelectors
      )
      if (legalResult.legalDescription) {
        console.log('  ✓ Legal description (' + legalResult.source + '): ' + legalResult.legalDescription)
      } else {
        console.log('  ⚠ Legal description not found — NOC will use address only')
      }

      var updateData = { parcel_number: parcelNumber.trim() }
      if (legalResult.legalDescription) {
        updateData.legal_description = legalResult.legalDescription
      }
      if (portalOwnerName && !jobData.owner_name) {
        updateData.owner_name = portalOwnerName.trim()
      }
      assertSupabaseOk(await supabase.from('jobs').update(updateData).eq('id', jobData.id), 'Save parcel and legal description on job')
      console.log('  ✓ Parcel saved: ' + parcelNumber)

      var urlBeforeSave = await clickSaveAndResumeLater(page, config)
      console.log('  ✓ Save and Resume Later clicked')

      var saveResult = await confirmPortalDraftSaved(page, urlBeforeSave)
      if (!saveResult.success) {
        await markPhase1SaveFailure(supabase, runId, jobData.id, saveResult.reason)
        throw Object.assign(new Error(saveResult.reason), { phase1Handled: true })
      }

      console.log('  ✓ Portal draft saved: ' + saveResult.portalConfirmation)
      console.log('  Portal saved URL: ' + saveResult.portalSavedUrl)
      if (saveResult.portalApplicationId) {
        console.log('  Portal application id: ' + saveResult.portalApplicationId)
      }

      var confirmationData = buildPortalConfirmationPayload(saveResult)
      assertSupabaseOk(await supabase.from('jobs').update({
        portal_confirmation: confirmationData,
      }).eq('id', jobData.id), 'Store portal save metadata on job')
      console.log('  ✓ Portal confirmation stored')

      step7Checkpoint.parcel = parcelNumber.trim()
      step7Checkpoint.owner = (portalOwnerName || '').trim()
      step7Checkpoint.portal_confirmation = confirmationData

      assertSupabaseOk(await supabase.from('automation_runs').update({
        run_status: RUN_STATUS_PHASE1_SUCCESS,
        completed_at: new Date().toISOString(),
      }).eq('id', runId), 'Mark automation run needs_review after Phase 1 success')
      console.log('  ✓ Automation run status: ' + RUN_STATUS_PHASE1_SUCCESS)

      if (!browserOpts.skipPostPhase1Chain) {
        console.log('  Starting post-Phase 1 automation chain...')
        try {
          var chainResult = await triggerNocAfterPhase1(jobData.id, Object.assign({}, browserOpts, {
            waitForProofCompletion: browserOpts.waitForProofCompletion !== false,
          }))
          console.log('  Chain stopping point: ' + (chainResult.stoppingPoint || 'unknown'))
          if (chainResult.phases && chainResult.phases.proofSend && chainResult.phases.proofSend.skipped) {
            console.log('  Proof send: skipped — ' + (chainResult.phases.proofSend.reason || 'unknown'))
          }
          if (chainResult.phases && chainResult.phases.proofComplete && chainResult.phases.proofComplete.complete) {
            console.log('  Proof complete — notarized NOC stored')
          }
          if (chainResult.stoppingPoint === 'ready_for_erecord_review') {
            console.log('  eRecord prep complete — ready for admin review')
          }
        } catch (chainErr) {
          console.error('  Post-Phase 1 chain failed (portal draft saved): ' + chainErr.message)
        }
      } else {
        console.log('  Post-Phase 1 chain skipped (skipPostPhase1Chain=true)')
      }
    }, step7Checkpoint)
    }

    console.log('\n========================================')
    console.log('PHASE 1 COMPLETE — POST-PHASE 1 CHAIN')
    console.log('========================================\n')

  } catch (err) {
    if (/login|session|expired|unauthorized|sign.?in/i.test(err.message || '')) {
      console.log('[' + sessionProvider + '] Session may have expired — clearing')
      await clearSession(sessionProvider, companyId)
    }
    if (!err.phase1Handled) await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    try {
      var state = await context.storageState()
      await saveSession(sessionProvider, companyId, state)
    } catch (sessionErr) {
      console.log('[' + sessionProvider + '] Could not save session:', sessionErr.message)
    }
    await context.close().catch(function () {})
    await browser.close()
  }
}

async function runPolkCounty(jobData, runId, runnerOptions) {
  return runAccelaPortal(jobData, runId, runnerOptions, defaultConfig, {
    resolveLegalDescription: resolvePolkLegalDescription,
  })
}

module.exports = {
  runPolkCounty,
  runAccelaPortal,
  validatePolkRunContract,
  resolvePolkPhase2Values,
  isPaymentBoundaryState,
}