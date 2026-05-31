require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const config = require('./ahjs/configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')

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

async function humanType(page, selector, value) {
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

async function domMouseClick(page, selector) {
  await page.evaluate(function(sel) {
    var el = document.querySelector(sel)
    if (!el) return
    var opts = { bubbles: true, cancelable: true, view: window }
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.dispatchEvent(new MouseEvent('click', opts))
  }, selector)
}

async function logSearchClickDiagnostics(page, urlBefore) {
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

async function blurSearchWithNeutralClick(page) {
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

async function evaluateSearchPoll(page) {
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

async function isSpinnerVisible(page) {
  var state = await evaluateSearchPoll(page)
  return !!state.spinnerVisible
}

async function waitForSpinnerVisible(page, deadline) {
  if (await isSpinnerVisible(page)) return true
  while (Date.now() < deadline) {
    await page.waitForTimeout(200)
    if (await isSpinnerVisible(page)) return true
  }
  return false
}

async function waitForSpinnerHidden(page, deadline, searchWaitStart) {
  while (Date.now() < deadline) {
    var elapsed = Date.now() - searchWaitStart
    var state = await evaluateSearchPoll(page)
    logSearchPoll(elapsed, state)
    var reason = searchSuccessReason(state)
    if (reason) return { quiet: true, success: reason, state: state }
    if (isPostbackQuiet(state)) return { quiet: true, success: null, state: state }
    await page.waitForTimeout(500)
  }
  return { quiet: false, success: null, state: null }
}

async function waitForSpinnerCycle(page, deadline, searchWaitStart, cycleNum) {
  console.log('  [spinner cycle ' + cycleNum + '] waiting for visible...')
  var visible = await waitForSpinnerVisible(page, deadline)
  if (!visible) {
    console.log('  [spinner cycle ' + cycleNum + '] spinner never became visible within budget')
    return 'no_spinner'
  }
  console.log('  [spinner cycle ' + cycleNum + '] spinner visible, waiting for hidden + async quiet...')
  var result = await waitForSpinnerHidden(page, deadline, searchWaitStart)
  if (result.success) return result.success
  if (result.quiet) {
    console.log('  [spinner cycle ' + cycleNum + '] postback quiet, waiting 2s before DOM inspection...')
    await page.waitForTimeout(2000)
    var elapsed = Date.now() - searchWaitStart
    var state = await evaluateSearchPoll(page)
    logSearchPoll(elapsed, state)
    var reason = searchSuccessReason(state)
    if (reason) return reason
    return 'cycle_complete'
  }
  return 'timeout'
}

async function waitForSearchPostbackResponse(page) {
  var searchWaitStart = Date.now()
  var searchWaitMax = 90000
  var searchWaitReason = 'timeout'
  var deadline = searchWaitStart + searchWaitMax
  var postbackFinished = false
  var lastState = {}

  console.log('  Waiting 2s before ASP.NET postback monitoring...')
  await page.waitForTimeout(2000)

  console.log('  Monitoring up to 90s for ASP.NET partial postback lifecycle...')

  lastState = await evaluateSearchPoll(page)
  logSearchPoll(Date.now() - searchWaitStart, lastState)
  var reason = searchSuccessReason(lastState)
  if (reason) {
    console.log('  Wait finished in ' + (Date.now() - searchWaitStart) + 'ms — condition: ' + reason)
    return reason
  }

  var cycle1 = await waitForSpinnerCycle(page, deadline, searchWaitStart, 1)
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
    if (await isSpinnerVisible(page)) {
      var cycle2 = await waitForSpinnerCycle(page, deadline, searchWaitStart, 2)
      if (cycle2 && cycle2 !== 'cycle_complete' && cycle2 !== 'no_spinner' && cycle2 !== 'timeout') {
        console.log('  Wait finished in ' + (Date.now() - searchWaitStart) + 'ms — condition: ' + cycle2)
        return cycle2
      }
      if (cycle2 === 'cycle_complete') postbackFinished = true
    }
  }

  while (Date.now() < deadline && !searchSuccessReason(lastState)) {
    var elapsed = Date.now() - searchWaitStart
    lastState = await evaluateSearchPoll(page)
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

async function getCredentials(companyId, ahjId) {
  const ws = require('ws')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .single()
  if (error || !data) throw new Error('No credentials found')
  return { username: data.username, password: data.portal_password }
}

async function logDomValues(page, label) {
  var values = await page.evaluate(function(sels) {
    function val(sel) {
      var el = document.querySelector(sel)
      return el ? (el.value || '').trim() : ''
    }
    function suffixInfo(sel) {
      var el = document.querySelector(sel)
      if (!el) return { value: '', text: '' }
      var opt = el.options[el.selectedIndex]
      return { value: el.value || '', text: opt ? opt.text.trim() : '' }
    }
    var suffix = suffixInfo(sels.streetType)
    return {
      streetNo: val(sels.streetNo),
      streetName: val(sels.streetName),
      suffixValue: suffix.value,
      suffixText: suffix.text,
      city: val(sels.city),
      zip: val(sels.zip),
      parcel: val(sels.parcelNo)
    }
  }, {
    streetNo: config.selectors.streetNo,
    streetName: config.selectors.streetName,
    streetType: config.selectors.streetType,
    city: config.selectors.city,
    zip: config.selectors.zip,
    parcelNo: config.selectors.parcelNo
  }).catch(function() { return {} })

  console.log('\n=== DOM values: ' + label + ' ===')
  console.log('  street number: "' + (values.streetNo || '') + '"')
  console.log('  street name: "' + (values.streetName || '') + '"')
  console.log('  suffix value: "' + (values.suffixValue || '') + '"')
  console.log('  suffix text: "' + (values.suffixText || '') + '"')
  console.log('  city: "' + (values.city || '') + '"')
  console.log('  zip: "' + (values.zip || '') + '"')
  console.log('  parcel: "' + (values.parcel || '') + '"')
  return values
}

async function capture(page, dir, name) {
  var png = path.join(dir, name + '.png')
  var html = path.join(dir, name + '.html')
  await page.screenshot({ path: png, fullPage: true })
  fs.writeFileSync(html, await page.content())
  console.log('  screenshot: ' + png)
  return png
}

async function run() {
  var jobData = {
    company_id: '384062a1-38eb-4612-a01c-6ae467d5d22f',
    ahj_id: '6d54bac8-9306-4fb4-b042-fbe086c007f2',
    property_address: '603 clayton circle',
    property_city: 'winter haven',
    property_zip: '33880'
  }

  var dir = path.join('automation', 'logs', 'step5-diagnose-' + Date.now())
  fs.mkdirSync(dir, { recursive: true })
  console.log('Output dir: ' + dir)

  var credentials = await getCredentials(jobData.company_id, jobData.ahj_id)
  var solver = new Solver(process.env.TWOCAPTCHA_API_KEY)
  var browser = await chromium.launch({ headless: true, slowMo: 300 })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)

  try {
    // Steps 1-4 — same as runner
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

    await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
    await page.waitForTimeout(500)
    await page.click('text=Continue Application')
    await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
    await page.waitForTimeout(2000)

    await page.click(config.selectors.permitTypeReRoof)
    await page.waitForTimeout(500)
    await page.click('text=Continue Application')
    await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
    await page.waitForTimeout(2000)

    // Step 5 fill — exact runner logic
    var parsed = parseAddress(jobData.property_address)
    var streetName = parsed.streetName.toUpperCase()
    var city = jobData.property_city ? jobData.property_city.toUpperCase() : ''
    var suffixLabel = parsed.suffix ? parsed.suffix.toUpperCase() : null
    console.log('\nParsed address:')
    console.log('  Street number: ' + parsed.streetNo)
    console.log('  Street name: ' + streetName)
    console.log('  Suffix: ' + (suffixLabel || 'none'))

    await humanType(page, config.selectors.streetNo, parsed.streetNo)
    await humanType(page, config.selectors.streetName, streetName)

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
      await humanType(page, config.selectors.city, city)
      console.log('  City filled: ' + city)
    }
    if (jobData.property_zip) {
      await humanType(page, config.selectors.zip, jobData.property_zip)
      console.log('  Zip filled: ' + jobData.property_zip)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(1000)
    }

    await page.waitForTimeout(500)

    await logDomValues(page, 'before Search click')
    await capture(page, dir, '01-before-search')

    var urlBeforeSearch = page.url()
    await domMouseClick(page, config.selectors.addressSearchBtn)
    await logSearchClickDiagnostics(page, urlBeforeSearch)

    await logDomValues(page, 'immediately after Search click')
    await capture(page, dir, '02-immediately-after-search')

    await blurSearchWithNeutralClick(page)

    var searchWaitReason = await waitForSearchPostbackResponse(page)

    var finalState = await evaluateSearchPoll(page).catch(function() { return {} })
    console.log('  spinner visible: ' + !!finalState.spinnerVisible)
    console.log('  parcel: "' + (finalState.parcelVal || '') + '"')
    if (searchWaitReason === 'postback_finished_no_result') {
      console.log('\nDiagnosis: (B) postback finished without parcel/owner/results')
    } else if (searchWaitReason === 'timeout') {
      console.log('\nDiagnosis: (C) ASP.NET async postback may be stuck')
    } else if (searchWaitReason === 'parcel populated' ||
      searchWaitReason === 'owner section populated by portal' ||
      searchWaitReason === 'property section updated by portal' ||
      searchWaitReason === 'selectable address result row appeared') {
      console.log('\nDiagnosis: (A) portal populated address data after postback')
    }

    await logDomValues(page, 'after wait')
    await capture(page, dir, '03-after-wait')

    console.log('\nDiagnosis complete.')
  } finally {
    await browser.close()
  }
}

run().catch(function(err) {
  console.error('Diagnosis failed:', err.message)
  process.exit(1)
})
