require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError } = require('../shared/errors')
const config = require('./configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function getCredentials(companyId, ahjId) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .single()
  if (error || !data) {
    throw Object.assign(
      new Error('No credentials found for this company and AHJ'),
      { errorCode: 'missing_credentials' }
    )
  }
  return { username: data.username, password: data.portal_password }
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

async function runPolkCounty(jobData, runId) {
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
  const browser = await chromium.launch({ headless: true, slowMo: 300 })
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
        await supabase.from('automation_runs').update({
          run_status: 'needs_review',
          error_message: 'Parcel number not populated. Check address format and dropdown selection.',
          completed_at: new Date().toISOString(),
        }).eq('id', runId)
        await supabase.from('jobs').update({ job_status: 'needs_review' }).eq('id', jobData.id)
        return
      }

      var updateData = { parcel_number: parcelNumber.trim() }
      if (portalOwnerName && !jobData.owner_name) {
        updateData.owner_name = portalOwnerName.trim()
      }
      await supabase.from('jobs').update(updateData).eq('id', jobData.id)
      console.log('  ✓ Parcel saved: ' + parcelNumber)

      await removeOverlay()
      await page.waitForSelector('a[onclick*="doSaveAndResume"]', { timeout: 10000 })
      await page.click('a[onclick*="doSaveAndResume"]')
      await page.waitForTimeout(3000)
      console.log('  ✓ Application saved in portal')

      await supabase.from('automation_runs').update({
        run_status: 'waiting_for_noc',
        completed_at: new Date().toISOString(),
      }).eq('id', runId)
      await supabase.from('jobs').update({ job_status: 'waiting_for_noc' }).eq('id', jobData.id)
      console.log('  ✓ Status: waiting_for_noc')

      var webAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roofing-permits-production.up.railway.app'
      fetch(webAppUrl + '/api/noc/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobData.id }),
      }).then(function(r) { return r.json() })
        .then(function(result) { console.log('  ✓ NOC pipeline triggered') })
        .catch(function(err) { console.error('  NOC trigger failed: ' + err.message) })
    })

    console.log('\n========================================')
    console.log('PHASE 1 COMPLETE — NOC PIPELINE STARTED')
    console.log('========================================\n')

  } catch (err) {
    await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { runPolkCounty }