require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError } = require('../shared/errors')
const config = require('./configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')
const { resolvePolkLegalDescription } = require('../../lib/parcels/polk-legal-description')
const { triggerNocAfterPhase1 } = require('../../lib/automation/noc-trigger')

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

async function clickSaveAndResumeLater(page) {
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

async function runPolkCounty(jobData, runId, runnerOptions) {
  var browserOpts = runnerOptions || {}
  console.log('\nStarting Polk County automation')
  console.log('Job: ' + jobData.owner_name + ' — ' + jobData.property_address)
  console.log('Run ID: ' + runId + '\n')

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
  console.log('✓ Credentials loaded for: ' + credentials.username + '\n')

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
  const browser = await chromium.launch({
    headless: browserOpts.headless !== undefined ? browserOpts.headless : true,
    slowMo: browserOpts.slowMo || 300,
  })
  const page = await browser.newPage()
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

  try {
    // Step 1 — Login
    stepNumber++
    await logStep(page, runId, stepNumber, 'login', async function() {
      await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      var frameHandle = await page.$('iframe:not(.mask_iframe)')
      var frame = await frameHandle.contentFrame()
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
    })

    // Step 2 — Navigate to disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'navigate_to_disclaimer', async function() {
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    })

    // Step 3 — Accept disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'accept_disclaimer', async function() {
      await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 4 — Select Re-Roof permit type
    stepNumber++
    await logStep(page, runId, stepNumber, 'select_reroof_permit', async function() {
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 5 — Fill address search with parsed components
    stepNumber++
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
    })

    // Step 6 — Select address result
    stepNumber++
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
    })

    // Step 7 — Phase 1 stop point
    stepNumber++
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
      var legalResult = await resolvePolkLegalDescription(
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

      var urlBeforeSave = await clickSaveAndResumeLater(page)
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

      assertSupabaseOk(await supabase.from('jobs').update({
        portal_confirmation: buildPortalConfirmationPayload(saveResult),
      }).eq('id', jobData.id), 'Store portal save metadata on job')
      console.log('  ✓ Portal confirmation stored')

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
    })

    console.log('\n========================================')
    console.log('PHASE 1 COMPLETE — POST-PHASE 1 CHAIN')
    console.log('========================================\n')

  } catch (err) {
    if (!err.phase1Handled) await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { runPolkCounty }