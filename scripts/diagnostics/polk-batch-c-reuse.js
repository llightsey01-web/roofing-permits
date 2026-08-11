/**
 * Batch C Steps 1–2 only — Polk live scenario (ONE draft + reuse test).
 *
 * Address (authorized): 4405 Glenns Landing, Winter Haven, FL 33884
 *
 * Allowed: accept disclaimer, fill form, Save and Resume Later, reopen draft, change earlier field.
 * Forbidden: submit, payment entry, delete, cancel, schedule, create a second draft.
 * Stop at payment screen if reached — document only.
 *
 * Usage: node scripts/diagnostics/polk-batch-c-reuse.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') })

const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const config = require('../../automation/ahjs/configs/polk-county.config.js')

const COMPANY_ID = 'd34dd732-ae39-450d-b717-a787c1fba408'
const AHJ_ID = '6d54bac8-9306-4fb4-b042-fbe086c007f2'
const OUT_DIR = path.join(__dirname, '..', '..', 'tmp', 'polk-batch-c')
const STORAGE_CANDIDATES = [
  path.join(__dirname, '..', '..', 'tmp', 'polk-batch-b', 'storageState-polk-gator.json'),
  path.join(__dirname, '..', '..', 'tmp', 'polk-batch-a', 'storageState-polk-gator.json'),
]

const TEST = {
  streetNo: '4405',
  streetName: 'GLENNS LANDING',
  city: 'WINTER HAVEN',
  zip: '33884',
  ownerName: 'Logan Lightsey',
  scopePlaceholder: 'BATCH-C TEST PLACEHOLDER — DO NOT SUBMIT — shingle reroof scenario',
  valuationPlaceholder: '999',
  squares: '25',
  roofTypeInitial: /shingle/i,
  roofTypeChanged: /metal/i,
}

const BLOCKED_CLICK = /submit(\s|$)|pay(\s|$|ment)|checkout|delete|cancel\s+(permit|application)|schedule\s+inspection|send\s+(email|notification)/i

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function log(msg) {
  console.log(msg)
  fs.appendFileSync(path.join(OUT_DIR, 'run.log'), msg + '\n')
}

function abortIfPayment(page, report) {
  // CapEdit URLs often include empty isFromShoppingCart= — do NOT treat that as cart.
  const u = (page.url() || '').toLowerCase()
  const onCartOrPay =
    /\/shoppingcart\//i.test(u) ||
    /\/payment\//i.test(u) ||
    /pay\.aspx/i.test(u) ||
    /checkout\.aspx/i.test(u) ||
    (/feeestimate/i.test(u) && !/capedit\.aspx/i.test(u))
  if (onCartOrPay) {
    report.stoppedAtPayment = true
    report.paymentUrl = page.url()
    throw new Error('STOP: payment/cart surface reached — documenting and aborting without acting')
  }
}

async function waitQuiet(page, ms) {
  await page.waitForTimeout(ms || 1500)
  await page.evaluate(function () {
    return new Promise(function (resolve) {
      var n = 0
      var t = setInterval(function () {
        n++
        var el = document.getElementById('divGlobalLoadingImg') || document.getElementById('divGlobalLoading')
        var busy = el && window.getComputedStyle(el).display !== 'none'
        if (!busy || n > 50) { clearInterval(t); resolve() }
      }, 250)
    })
  }).catch(function () {})
}

async function removeOverlay(page) {
  await page.evaluate(function () {
    var mask = document.getElementById('dvACADialogLayerMask')
    if (mask) mask.remove()
    document.querySelectorAll('.mask_iframe, iframe.mask_iframe').forEach(function (el) { el.remove() })
    document.querySelectorAll('[id*="Mask"], [class*="mask"]').forEach(function (el) {
      el.style.display = 'none'
      el.style.pointerEvents = 'none'
    })
  }).catch(function () {})
}

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) {
    log('[login] session valid → Dashboard')
    return
  }
  const frameHandle = await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 20000 })
  const frame = await frameHandle.contentFrame()
  if (!frame) throw new Error('Login iframe missing')
  await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
  await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
  log('[login] Solving reCAPTCHA via 2Captcha…')
  const result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
  await frame.evaluate(function (token) {
    document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function (el) {
      el.style.display = 'block'
      el.value = token
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    var tryCallback = function (obj, token, depth) {
      depth = depth || 0
      if (depth > 5 || !obj) return
      try {
        if (typeof obj === 'object') {
          Object.keys(obj).forEach(function (key) {
            if (key === 'callback' && typeof obj[key] === 'function') obj[key](token)
            else tryCallback(obj[key], token, depth + 1)
          })
        }
      } catch (e) {}
    }
    if (window.___grecaptcha_cfg) tryCallback(window.___grecaptcha_cfg, token)
  }, result.data)
  await page.waitForTimeout(1500)
  await frame.evaluate(function () {
    document.querySelectorAll('button').forEach(function (b) {
      if ((b.textContent || '').includes('Sign In')) b.click()
    })
  })
  await page.waitForURL('**/Dashboard.aspx**', { timeout: 60000 })
  await page.waitForTimeout(2000)
  log('[login] OK → ' + page.url())
}

async function safeClickContinue(page, report) {
  abortIfPayment(page, report)
  const btn = page.locator('a, button, input[type="button"], input[type="submit"]').filter({
    hasText: /Continue Application|Continue/i,
  }).first()
  if (!(await btn.count())) {
    log('[continue] no Continue control found')
    return false
  }
  const text = await btn.innerText().catch(function () { return 'Continue' })
  if (BLOCKED_CLICK.test(text)) {
    throw new Error('Refusing blocked control: ' + text)
  }
  log('[continue] clicking: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60))
  await removeOverlay(page)
  await btn.click({ force: true }).catch(async function () {
    await page.evaluate(function () {
      var els = Array.from(document.querySelectorAll('a, button, input'))
      var t = els.find(function (el) {
        return /continue\s+application/i.test((el.innerText || el.value || ''))
      })
      if (t) t.click()
    })
  })
  await waitQuiet(page, 2500)
  abortIfPayment(page, report)
  return true
}

async function clickSaveAndResume(page) {
  await removeOverlay(page)
  var saveSelector = config.selectors.saveAndResumeBtn + ', a[onclick*="doSaveAndResume"], a:has-text("Save and Resume Later")'
  await page.waitForSelector(saveSelector, { timeout: 15000 })
  var urlBefore = page.url()
  log('[save] Save and Resume Later')
  await page.click(saveSelector, { force: true })
  await waitQuiet(page, 3000)
  await page.waitForTimeout(2000)
  return { urlBefore: urlBefore, urlAfter: page.url() }
}

async function snapshotForm(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      return el.getBoundingClientRect().width > 0
    }
    var fields = []
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden') return
      if (!visible(el)) return
      var val = ''
      if (el.tagName === 'SELECT') {
        var opt = el.options[el.selectedIndex]
        val = opt ? (opt.text || opt.value) : ''
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        val = el.checked ? 'checked' : 'unchecked'
      } else {
        val = el.value || ''
      }
      fields.push({
        id: el.id || null,
        name: el.name || null,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        value: String(val).slice(0, 120),
      })
    })
    return {
      url: location.href,
      title: document.title,
      h1: (document.querySelector('h1, .ACA_PageTitle, #ctl00_PlaceHolderMain_lblPageTitle') || {}).innerText || '',
      fields: fields,
    }
  })
}

async function getRoofTypeOptions(page) {
  const sel = config.selectors.roofType
  if (!(await page.locator(sel).count())) return []
  return page.locator(sel + ' option').evaluateAll(function (opts) {
    return opts.map(function (o) {
      return { value: o.value, text: (o.text || '').trim() }
    }).filter(function (o) { return o.text && o.text !== '--Select--' })
  })
}

async function selectRoofTypeMatching(page, re) {
  const sel = config.selectors.roofType
  if (!(await page.locator(sel).count())) return { ok: false, reason: 'roofType select missing' }
  const options = await getRoofTypeOptions(page)
  const match = options.find(function (o) { return re.test(o.text) })
  if (!match) return { ok: false, reason: 'no option matching ' + re, options: options }
  await page.selectOption(sel, { value: match.value }).catch(async function () {
    await page.selectOption(sel, { label: match.text })
  })
  await waitQuiet(page, 1000)
  const current = await page.locator(sel).evaluate(function (el) {
    var o = el.options[el.selectedIndex]
    return o ? o.text.trim() : ''
  })
  return { ok: true, selected: current, options: options }
}

async function humanType(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000 })
  await page.click(selector)
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(String(value), { delay: 60 })
  await page.evaluate(function (sel) {
    var el = document.querySelector(sel)
    if (!el) return
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
  }, selector)
  await page.waitForTimeout(200)
}

async function closeAddressDialog(page) {
  var closed = await page.evaluate(function () {
    var dialog = document.getElementById('dvACADialogLayer')
    if (!dialog) return false
    var style = window.getComputedStyle(dialog)
    if (style.display === 'none' || dialog.classList.contains('ACA_Hide')) return false
    var cancel = Array.from(dialog.querySelectorAll('a, button, input')).find(function (el) {
      return /cancel|close|ok/i.test((el.innerText || el.value || '').trim())
    })
    if (cancel) {
      cancel.click()
      return true
    }
    return false
  })
  if (closed) {
    log('[addr] closed address-result dialog')
    await waitQuiet(page, 1500)
  }
  await removeOverlay(page)
}

async function setStreetType(page, label) {
  if (!label || !(await page.locator(config.selectors.streetType).count())) return false
  var ok = await page.evaluate(function (args) {
    var el = document.querySelector(args.sel)
    if (!el) return false
    var opt = Array.from(el.options).find(function (o) {
      var t = (o.text || '').trim().toUpperCase()
      return t === args.label.toUpperCase() || t.indexOf(args.label.toUpperCase()) === 0
    })
    if (!opt) return false
    el.value = opt.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, { sel: config.selectors.streetType, label: label })
  return !!ok
}

async function listStreetTypes(page) {
  if (!(await page.locator(config.selectors.streetType).count())) return []
  return page.locator(config.selectors.streetType + ' option').evaluateAll(function (opts) {
    return opts.map(function (o) { return (o.text || '').trim() })
      .filter(function (t) { return t && !/^--/.test(t) })
  })
}

async function attemptAddressSearch(page, variant) {
  log('[addr] trying variant: ' + JSON.stringify(variant))
  await closeAddressDialog(page)
  await humanType(page, config.selectors.streetNo, variant.streetNo || TEST.streetNo)
  await humanType(page, config.selectors.streetName, variant.streetName)
  if (await page.locator(config.selectors.streetType).count()) {
    await page.selectOption(config.selectors.streetType, { index: 0 }).catch(function () {})
  }
  if (variant.streetType) {
    var typed = await setStreetType(page, variant.streetType)
    log('[addr] streetType "' + variant.streetType + '" set=' + typed)
  }
  if (variant.city != null) {
    if (variant.city === '') await page.fill(config.selectors.city, '')
    else await humanType(page, config.selectors.city, variant.city)
  } else {
    await humanType(page, config.selectors.city, TEST.city)
  }
  if (await page.locator(config.selectors.state).count()) {
    await page.evaluate(function (sel) {
      var el = document.querySelector(sel)
      if (!el) return
      var opt = Array.from(el.options).find(function (o) {
        return /^(FL|Florida)$/i.test((o.text || '').trim()) || o.value === 'FL'
      })
      if (opt) {
        el.value = opt.value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, config.selectors.state)
  }
  await page.evaluate(function (args) {
    var el = document.querySelector(args.sel)
    if (!el) return
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.value = args.zip
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
  }, { sel: config.selectors.zip, zip: variant.zip || TEST.zip })
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)

  await removeOverlay(page)
  await page.evaluate(function (sel) {
    var el = document.querySelector(sel)
    if (!el) return
    var opts = { bubbles: true, cancelable: true, view: window }
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.dispatchEvent(new MouseEvent('click', opts))
  }, config.selectors.addressSearchBtn)
  await waitQuiet(page, 4000)

  for (var i = 0; i < 30; i++) {
    var state = await page.evaluate(function (sels) {
      function val(sel) {
        var el = document.querySelector(sel)
        return el ? (el.value || '').trim() : ''
      }
      var rows = []
      document.querySelectorAll(sels.addressResult + ', #dvACADialogLayer .ACA_Grid_Row').forEach(function (row) {
        var text = (row.innerText || '').replace(/\s+/g, ' ').trim()
        if (text && /^\d+/.test(text)) rows.push(text.slice(0, 120))
      })
      var dialogText = ''
      var dialog = document.getElementById('dvACADialogLayer')
      if (dialog) dialogText = (dialog.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return {
        parcel: val(sels.parcelNo),
        owner: val(sels.ownerName),
        rows: rows.slice(0, 5),
        dialogText: dialogText,
        noRecords: /no records found/i.test(dialogText),
      }
    }, {
      parcelNo: config.selectors.parcelNo,
      ownerName: config.selectors.ownerName,
      addressResult: config.selectors.addressResult,
    })

    if (state.parcel) {
      return { ok: true, parcel: state.parcel, owner: state.owner || null, variant: variant }
    }
    if (state.rows.length) {
      log('[addr] selecting grid row: ' + state.rows[0])
      await page.evaluate(function (sel) {
        var rows = Array.from(document.querySelectorAll(sel + ', #dvACADialogLayer .ACA_Grid_Row'))
          .filter(function (row) {
            var text = (row.innerText || '').trim()
            return text && /^\d+/.test(text)
          })
        if (!rows[0]) return
        var link = rows[0].querySelector('a')
        ;(link || rows[0]).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }, config.selectors.addressResult)
      await waitQuiet(page, 4000)
      continue
    }
    if (state.noRecords) {
      log('[addr] no records for this variant')
      await closeAddressDialog(page)
      return { ok: false, reason: 'no_records', variant: variant }
    }
    await page.waitForTimeout(400)
  }
  await closeAddressDialog(page)
  return { ok: false, reason: 'timeout', variant: variant }
}

async function fillAddress(page) {
  log('[addr] filling 4405 Glenns Landing (multi-variant search)…')
  var existingParcel = await page.$eval(config.selectors.parcelNo, function (el) {
    return (el.value || '').trim()
  }).catch(function () { return '' })
  if (existingParcel) {
    log('[addr] parcel already present on resumed draft: ' + existingParcel + ' — skipping search')
    var owner = await page.$eval(config.selectors.ownerName, function (el) {
      return (el.value || '').trim()
    }).catch(function () { return '' })
    return { parcel: existingParcel, owner: owner || null, variant: { skipped: true, reason: 'already_populated' }, attempts: [] }
  }

  var streetTypes = await listStreetTypes(page)
  log('[addr] streetType options sample: ' + JSON.stringify(streetTypes.filter(function (t) {
    return /land|lndg|ln|way|dr|cir|ct|pl/i.test(t)
  }).slice(0, 40)))

  var landingLabel = streetTypes.find(function (t) { return /^landing$/i.test(t) })
    || streetTypes.find(function (t) { return /^lndg$/i.test(t) })
    || streetTypes.find(function (t) { return /landing/i.test(t) })
    || null

  var variants = [
    { streetName: 'GLENNS', streetType: landingLabel || 'Landing' },
    { streetName: 'GLENNS', streetType: 'Lndg' },
    { streetName: 'GLENNS LNDG', streetType: null },
    { streetName: 'GLENNS LANDING', streetType: null },
    { streetName: 'GLENNS', streetType: landingLabel || 'Landing', city: '' },
    { streetName: 'GLENN', streetType: landingLabel || 'Landing' },
  ]

  var attempts = []
  for (var v = 0; v < variants.length; v++) {
    var result = await attemptAddressSearch(page, variants[v])
    attempts.push({ variant: variants[v], ok: result.ok, reason: result.reason || null, parcel: result.parcel || null })
    if (result.ok) {
      log('[addr] SUCCESS parcel=' + result.parcel + ' via ' + JSON.stringify(variants[v]))
      return { parcel: result.parcel, owner: result.owner || null, variant: variants[v], attempts: attempts }
    }
  }

  log('[addr] all variants failed')
  return { parcel: '', owner: null, attempts: attempts }
}

async function fillPermitDetailBasics(page, report) {
  // Required radios / dropdowns from config defaults — best effort
  async function clickIfPresent(sel) {
    if (await page.locator(sel).count()) {
      await page.click(sel, { force: true }).catch(function () {})
      await page.waitForTimeout(300)
      return true
    }
    return false
  }
  async function selectDefault(sel, label) {
    if (!(await page.locator(sel).count())) return false
    await page.selectOption(sel, { label: label }).catch(async function () {
      await page.evaluate(function (args) {
        var el = document.querySelector(args.sel)
        if (!el) return
        var opt = Array.from(el.options).find(function (o) {
          return (o.text || '').indexOf(args.label) !== -1
        })
        if (opt) {
          el.value = opt.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }, { sel: sel, label: label })
    })
    return true
  }
  // Click "No" radio near a label substring (diagnostic only — not written to config)
  async function clickNoNearLabel(labelRe) {
    return page.evaluate(function (reSource) {
      var re = new RegExp(reSource, 'i')
      var labels = Array.from(document.querySelectorAll('label, span, td, div'))
      for (var i = 0; i < labels.length; i++) {
        var t = (labels[i].innerText || '').replace(/\s+/g, ' ').trim()
        if (!re.test(t) || t.length > 160) continue
        var root = labels[i].closest('tr, table, div') || labels[i].parentElement
        if (!root) continue
        var nos = Array.from(root.querySelectorAll('input[type="radio"], label'))
        for (var j = 0; j < nos.length; j++) {
          var el = nos[j]
          var txt = (el.innerText || el.value || '').trim()
          if (el.tagName === 'INPUT' && /no/i.test(el.value || '')) {
            el.click()
            return true
          }
          if (el.tagName === 'LABEL' && /^no$/i.test(txt)) {
            el.click()
            return true
          }
        }
      }
      return false
    }, labelRe.source || labelRe)
  }

  await clickIfPresent(config.selectors.gateAccessNo)
  await clickIfPresent(config.selectors.codeViolationNo)
  await clickIfPresent(config.selectors.roofDeckNo)
  await clickNoNearLabel(/Is the Applicant the Owner/i)
  await clickNoNearLabel(/Private Provider/i)
  await clickNoNearLabel(/inspections to be performed virtually/i)

  await selectDefault(config.selectors.nocDropdown, config.defaultValues.nocDropdown)
  await selectDefault(config.selectors.packetSubmission, config.defaultValues.packetSubmission)
  await selectDefault(config.selectors.fs119Status, config.defaultValues.fs119Status)
  await selectDefault(config.selectors.workType, config.defaultValues.workType)
  await selectDefault(config.selectors.propertyType, config.defaultValues.propertyType)
  await selectDefault(config.selectors.reroofPermitType, config.defaultValues.reroofPermitType)

  // Construction Waste if present — pick first non-empty option that looks like acknowledgement
  await page.evaluate(function () {
    var selects = Array.from(document.querySelectorAll('select'))
    selects.forEach(function (el) {
      var id = el.id || ''
      var nearby = (el.closest('tr, td, div') || el.parentElement)
      var label = nearby ? (nearby.innerText || '').slice(0, 120) : ''
      if (!/construction waste/i.test(label + ' ' + id)) return
      var opt = Array.from(el.options).find(function (o) {
        var t = (o.text || '').trim()
        return t && !/^--/.test(t) && !/select/i.test(t)
      })
      if (opt) {
        el.value = opt.value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
  })

  if (await page.locator(config.selectors.numberOfSquares).count()) {
    await page.fill(config.selectors.numberOfSquares, TEST.squares)
  }

  if (await page.locator(config.selectors.crossStreet).count()) {
    await page.fill(config.selectors.crossStreet, 'BATCH-C-TEST-DO-NOT-SUBMIT')
  }

  var roof = await selectRoofTypeMatching(page, TEST.roofTypeInitial)
  report.step1.roofTypeSet = {
    ok: roof.ok,
    selected: roof.selected || null,
    reason: roof.reason || null,
    optionLabels: (roof.options || []).map(function (o) { return o.text }).slice(0, 25),
  }
  log('[detail] roof type initial: ' + JSON.stringify(report.step1.roofTypeSet))

  await clickIfPresent(config.selectors.reroofAffidavit)
  await clickIfPresent(config.selectors.asbestosStatement)
}

async function aspNetPostBack(page, eventTarget) {
  log('[postback] __EVENTTARGET=' + eventTarget)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function () {}),
    page.evaluate(function (target) {
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
  await waitQuiet(page, 2000)
}

async function waitForResumeModalOrCapEdit(page, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 45000)
  while (Date.now() < deadline) {
    var state = await page.evaluate(function () {
      var layer = document.getElementById('dvACADialogLayer')
      function vis(el) {
        if (!el) return false
        var s = window.getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetHeight > 10 && !el.classList.contains('ACA_Hide')
      }
      var modalText = layer && vis(layer) ? (layer.innerText || '').replace(/\s+/g, ' ').trim() : ''
      return {
        url: location.href,
        capEdit: /CapEdit\.aspx/i.test(location.href),
        modal: vis(layer) && /Select Application Page Flow Step|Pick up where I left off|Start from the beginning/i.test(modalText),
      }
    })
    if (state.capEdit) return { kind: 'capEdit', state: state }
    if (state.modal) return { kind: 'modal', state: state }
    await page.waitForTimeout(500)
  }
  return { kind: 'timeout', state: { url: page.url() } }
}

async function handleResumePageFlowModal(page) {
  log('[modal] waiting for page-flow dialog…')
  var waited = await waitForResumeModalOrCapEdit(page, 30000)
  if (waited.kind === 'capEdit') {
    log('[modal] CapEdit reached without modal')
    return { skipped: true }
  }
  if (waited.kind !== 'modal') {
    throw new Error('Resume page-flow modal not detected (url=' + page.url() + ')')
  }

  var picked = await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    if (!layer) return false
    var target = null
    Array.from(layer.querySelectorAll('input[type="radio"]')).forEach(function (r) {
      var label = ''
      if (r.id) {
        var lab = layer.querySelector('label[for="' + r.id + '"]')
        if (lab) label = (lab.innerText || '').trim()
      }
      if (!label) {
        var p = r.closest('td, tr, div')
        if (p) label = (p.innerText || '').trim()
      }
      if (/Pick up where I left off/i.test(label)) target = r
    })
    if (!target) {
      var radios = layer.querySelectorAll('input[type="radio"]')
      if (radios.length >= 2) target = radios[1]
    }
    if (!target) return false
    target.checked = true
    target.click()
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })
  if (!picked) throw new Error('Could not select Pick up where I left off')

  var okClicked = await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    if (!layer) return false
    var btn = Array.from(layer.querySelectorAll('a, button, input[type="button"], input[type="submit"]')).find(function (el) {
      return /^OK$/i.test((el.innerText || el.value || '').replace(/\s+/g, ' ').trim())
    })
    if (!btn) return false
    btn.click()
    return true
  })
  if (!okClicked) {
    await page.locator('#dvACADialogLayer a, #dvACADialogLayer button, #dvACADialogLayer input').filter({ hasText: /^OK$/i }).first().click({ force: true })
  }
  log('[modal] Pick up where I left off + OK')
  await waitQuiet(page, 4000)
  await page.waitForURL(/CapEdit\.aspx/i, { timeout: 45000 })
  await waitQuiet(page, 2500)
  return { skipped: false }
}

async function findAndResumeDraft(page, report, preferredAltId) {
  log('[resume] opening MyRecords…')
  await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await waitQuiet(page, 2500)

  // Only leaf rows for THIS test address / known TMP — never harvest other customers' permits
  var found = await page.evaluate(function (preferred) {
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
    var rows = Array.from(document.querySelectorAll('table[id$="gdvPermitList"] tr, tr.ACA_Grid_Row, tr'))
    var candidates = []
    rows.forEach(function (tr, idx) {
      // Skip rows that nest other data rows (grid chrome wrappers)
      if (tr.querySelector('table')) return
      var text = clean(tr.innerText)
      if (!text || text.length > 350) return
      var isAddr = /4405\s+GLENNS\s+(LANDING|LNDG)|glenns\s+(landing|lndg)/i.test(text)
      var isTmp = /26TMP-\d+/i.test(text)
      var altMatch = text.match(/26TMP-\d+/i)
      var altId = altMatch ? altMatch[0] : null
      if (preferred && altId && altId.toUpperCase() !== preferred.toUpperCase()) return
      if (!(isAddr || (preferred && altId))) return
      var resume = Array.from(tr.querySelectorAll('a, button')).find(function (el) {
        return /resume\s+application/i.test(clean(el.innerText || el.title || ''))
      })
      candidates.push({
        idx: idx,
        altId: altId,
        text: text.slice(0, 160),
        hasResume: !!resume,
        score: (isAddr ? 5 : 0) + (preferred && altId ? 5 : 0) + (isTmp ? 2 : 0) + (resume ? 3 : 0),
      })
    })
    candidates.sort(function (a, b) { return b.score - a.score })
    return candidates.slice(0, 3)
  }, preferredAltId || null)

  report.step2 = report.step2 || {}
  report.step2.resumeCandidates = found
  log('[resume] target candidates: ' + JSON.stringify(found))

  if (!found.length) return { ok: false, reason: 'no Glenns Landing / preferred TMP draft on MyRecords' }

  var best = found[0]

  var postTarget = await page.evaluate(function (preferred) {
    var rows = Array.from(document.querySelectorAll('tr')).filter(function (tr) {
      return !tr.querySelector('table') && (tr.innerText || '').indexOf(preferred) !== -1
    })
    if (!rows[0]) return null
    var a = Array.from(rows[0].querySelectorAll('a')).find(function (el) {
      return /resume\s+application/i.test((el.innerText || '').trim())
    })
    if (!a) return null
    var href = a.getAttribute('href') || ''
    var m = href.match(/__doPostBack\('([^']+)'/)
    return m ? { btnId: a.id, postTarget: m[1] } : null
  }, best.altId || preferredAltId)

  if (!postTarget) {
    return { ok: false, reason: 'Resume Application postback target not found', best: best }
  }

  log('[resume] aspNet postback #' + postTarget.btnId)
  try {
    await aspNetPostBack(page, postTarget.postTarget)
    var modalResult = await handleResumePageFlowModal(page)
  } catch (navErr) {
    log('[resume] failed: ' + navErr.message.slice(0, 120))
    return {
      ok: false,
      reason: navErr.message,
      url: page.url(),
      altId: best.altId,
      method: 'aspNetPostBack+modal',
    }
  }

  await waitQuiet(page, 2500)
  abortIfPayment(page, report)
  return {
    ok: true,
    url: page.url(),
    altId: best.altId,
    method: 'aspNetPostBack+modal',
    btnId: postTarget.btnId,
    modal: modalResult,
  }
}

async function main() {
  ensureOut()
  fs.writeFileSync(path.join(OUT_DIR, 'run.log'), '')
  log('=== Batch C Steps 1–2 — ONE draft + reuse test ===')
  log('Address: 4405 Glenns Landing, Winter Haven, FL 33884 (authorized)')
  log('Rules: no submit/pay/delete/cancel/schedule; stop at payment; one draft only')

  const report = {
    generatedAt: new Date().toISOString(),
    address: '4405 Glenns Landing, Winter Haven, FL 33884',
    authorized: true,
    safety: {
      submitted: false,
      paid: false,
      deleted: false,
      cancelled: false,
      scheduled: false,
      draftsCreated: 0,
      disclaimerAccepted: false,
    },
    step1: {},
    step2: {},
    stoppedAtPayment: false,
  }

  const svc = await import('../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)
  const solver = new Solver(process.env.TWOCAPTCHA_API_KEY)

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })
  const contextOpts = {
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
  for (var i = 0; i < STORAGE_CANDIDATES.length; i++) {
    if (fs.existsSync(STORAGE_CANDIDATES[i])) {
      contextOpts.storageState = STORAGE_CANDIDATES[i]
      log('[session] using ' + STORAGE_CANDIDATES[i])
      break
    }
  }
  const context = await browser.newContext(contextOpts)
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: path.join(OUT_DIR, 'storageState-polk-gator.json') })

    // Prefer the ONE existing Glenns Landing draft from the prior attempt — do NOT create a second
    const EXISTING = process.env.BATCH_C_EXISTING_DRAFT || '26TMP-043760'
    log('[step1] checking for existing draft ' + EXISTING + ' (reuse — no second draft)')
    var resumedExisting = await findAndResumeDraft(page, report, EXISTING)
    report.step1.existingDraftAttempt = resumedExisting

    if (resumedExisting.ok) {
      log('[step1] resumed existing draft — draftsCreated remains 1 (prior run)')
      report.safety.draftsCreated = 1
      report.step1.altId = resumedExisting.altId || EXISTING
      report.step1.createdThisRun = false
    } else {
      log('[step1] no usable existing draft (' + resumedExisting.reason + ') — creating ONE new draft')
      log('[step1] disclaimer…')
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await waitQuiet(page, 2000)
      await page.check(config.selectors.disclaimerCheckbox)
      report.safety.disclaimerAccepted = true
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL(/CapType\.aspx|UserLicenseList\.aspx/i, { timeout: 30000 })
      await waitQuiet(page, 2000)

      if (/UserLicenseList/i.test(page.url())) {
        log('[step1] UserLicenseList — select contractor license')
        await page.screenshot({ path: path.join(OUT_DIR, '00-license-list.png'), fullPage: true }).catch(function () {})
        var licenseInfo = await page.evaluate(function () {
          var selects = Array.from(document.querySelectorAll('select'))
          var target = selects.find(function (sel) {
            var label = ''
            var id = sel.id || ''
            var lab = id ? document.querySelector('label[for="' + id + '"]') : null
            if (lab) label = lab.innerText || ''
            var prev = sel.previousElementSibling
            if (prev) label += ' ' + (prev.innerText || '')
            var parent = sel.closest('td, div, tr')
            if (parent) label += ' ' + (parent.innerText || '').slice(0, 80)
            return /license/i.test(label + ' ' + id)
          }) || selects[0]
          if (!target) return { ok: false, reason: 'no select found' }
          var options = Array.from(target.options).map(function (o) {
            return { value: o.value, text: (o.text || '').trim() }
          }).filter(function (o) {
            return o.value && o.text && !/^--/.test(o.text) && !/select/i.test(o.text)
          })
          // Prefer Roofing CCC over "None Applicable"
          var pick = options.find(function (o) { return /roofing|ccc/i.test(o.text) }) || options[0]
          return {
            ok: true,
            id: target.id || null,
            options: options.map(function (o) {
              var text = o.text.replace(/\b([A-Z]{1,5})\s*#?\s*(\d{4,})\b/gi, function (_m, p, n) {
                return p + '-****' + String(n).slice(-4)
              })
              return { value: '[PRESENT]', text: text }
            }),
            rawCount: options.length,
            pickValue: pick ? pick.value : null,
            pickText: pick ? pick.text : null,
          }
        })
        report.step1.licenseList = {
          optionCount: licenseInfo.rawCount || 0,
          optionsRedacted: licenseInfo.options || [],
        }
        if (!licenseInfo.ok || !licenseInfo.pickValue) {
          throw new Error('UserLicenseList: no selectable license option')
        }
        log('[step1] selecting license: ' + (licenseInfo.pickText || '').replace(/\d{5,}/g, '****').slice(0, 80))
        await page.evaluate(function (args) {
          var target = args.id ? document.getElementById(args.id) : null
          if (!target) {
            var selects = Array.from(document.querySelectorAll('select'))
            target = selects.find(function (sel) {
              return /license/i.test(sel.id || '')
            }) || selects[0]
          }
          if (!target) return
          target.value = args.value
          target.dispatchEvent(new Event('change', { bubbles: true }))
        }, { id: licenseInfo.id, value: licenseInfo.pickValue })
        await waitQuiet(page, 1000)
        await page.click('text=Continue Application')
        await page.waitForURL('**/CapType.aspx**', { timeout: 30000 })
        await waitQuiet(page, 2000)
      }

      log('[step1] CapType — select Re-Roof')
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 30000 })
      await waitQuiet(page, 2500)
      report.safety.draftsCreated = 1
      report.step1.createdThisRun = true
    }

    report.step1.capEditUrl = page.url().replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]')

    var addr = await fillAddress(page)
    report.step1.parcel = addr.parcel || null
    report.step1.owner = addr.owner ? String(addr.owner).slice(0, 60) : null
    report.step1.addressVariant = addr.variant || null
    report.step1.addressAttempts = addr.attempts || null
    await page.screenshot({ path: path.join(OUT_DIR, '01-address.png'), fullPage: true }).catch(function () {})

    if (!addr.parcel) {
      var pageErrors = await page.evaluate(function () {
        return Array.from(document.querySelectorAll('.ACA_Error, .ACA_ErrorMessageLabel, .ACA_Message_Error'))
          .map(function (el) { return (el.innerText || '').replace(/\s+/g, ' ').trim() })
          .filter(Boolean)
          .slice(0, 5)
      })
      report.step1.addressErrors = pageErrors
      log('[step1] address/parcel still empty; errors=' + JSON.stringify(pageErrors))
      throw new Error('Parcel not populated after address search — refusing to Continue/create further residue')
    }

    // Continue toward permit detail
    for (var c = 0; c < 4; c++) {
      abortIfPayment(page, report)
      var before = page.url()
      if (await page.locator(config.selectors.roofType).count()) {
        log('[step1] permit detail fields visible')
        break
      }
      var continued = await safeClickContinue(page, report)
      if (!continued) break
      if (page.url() === before) {
        // URL may stay CapEdit while page section changes — check for validation errors
        var errs = await page.evaluate(function () {
          return Array.from(document.querySelectorAll('.ACA_Error, .ACA_ErrorMessageLabel'))
            .map(function (el) { return (el.innerText || '').replace(/\s+/g, ' ').trim() })
            .filter(Boolean)
            .slice(0, 5)
        })
        if (errs.length) {
          log('[step1] Continue blocked by validation: ' + JSON.stringify(errs))
          report.step1.continueErrors = errs
          break
        }
        await waitQuiet(page, 2000)
        if (await page.locator(config.selectors.roofType).count()) break
        log('[step1] Continue did not reveal roof type — stop advancing')
        break
      }
    }

    abortIfPayment(page, report)
    report.step1.beforeDetailFieldCount = (await snapshotForm(page)).fields.length

    if (await page.locator(config.selectors.roofType).count()) {
      await fillPermitDetailBasics(page, report)
    } else {
      report.step1.note = 'Roof type control not reached before save'
      log('[step1] ' + report.step1.note)
      throw new Error('Cannot complete Step 1 reuse prerequisite — roof type not reachable on this draft yet')
    }

    await page.screenshot({ path: path.join(OUT_DIR, '02-before-save.png'), fullPage: true }).catch(function () {})
    var saveResult = await clickSaveAndResume(page)
    report.step1.save = saveResult
    report.step1.afterSaveUrl = page.url()
      .replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]')
      .replace(/(altId=)[^&]+/i, '$1[PRESENT]')
    // Capture altId separately for our consented draft only
    var altFromUrl = (page.url().match(/altId=([^&]+)/i) || [])[1]
    if (altFromUrl) {
      report.step1.altId = decodeURIComponent(altFromUrl)
      log('[step1] saved altId=' + report.step1.altId)
    }
    await page.screenshot({ path: path.join(OUT_DIR, '03-after-save.png'), fullPage: true }).catch(function () {})

    // ── STEP 2: reopen + change roof type ──
    log('[step2] reopen draft…')
    var targetAlt = report.step1.altId || EXISTING
    var resumed = await findAndResumeDraft(page, report, targetAlt)
    report.step2.resume = resumed
    if (!resumed.ok) {
      log('[step2] FAILED to resume: ' + resumed.reason)
      report.step2.reuseWorks = false
      report.step2.failureMode = resumed.reason
    } else {
      log('[step2] resumed → ' + page.url().replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]'))
      abortIfPayment(page, report)

      for (var n = 0; n < 6; n++) {
        if (await page.locator(config.selectors.roofType).count()) break
        var prev = page.locator('a, button').filter({ hasText: /Previous|Back|Permit Detail|Application Information|Location/i }).first()
        if (await prev.count()) {
          var pt = await prev.innerText().catch(function () { return '' })
          if (!BLOCKED_CLICK.test(pt) && !/submit|pay/i.test(pt)) {
            log('[step2] nav: ' + pt.slice(0, 40))
            await prev.click({ force: true }).catch(function () {})
            await waitQuiet(page, 2000)
          } else break
        } else {
          // Try Continue forward if we landed on location step
          if (await page.locator(config.selectors.streetNo).count() && !(await page.locator(config.selectors.roofType).count())) {
            await safeClickContinue(page, report)
          } else break
        }
        abortIfPayment(page, report)
      }

      if (!(await page.locator(config.selectors.roofType).count())) {
        report.step2.reuseWorks = false
        report.step2.failureMode = 'Could not locate roof type control after resume'
        report.step2.afterResumeUrl = page.url().replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]')
      } else {
        var beforeRoof = await page.locator(config.selectors.roofType).evaluate(function (el) {
          var o = el.options[el.selectedIndex]
          return o ? o.text.trim() : ''
        })
        report.step2.roofTypeBefore = beforeRoof
        log('[step2] roof before: ' + beforeRoof)

        var changed = await selectRoofTypeMatching(page, TEST.roofTypeChanged)
        report.step2.changeAttempt = {
          ok: changed.ok,
          selected: changed.selected || null,
          reason: changed.reason || null,
          optionLabels: (changed.options || []).map(function (o) { return o.text }).slice(0, 20),
        }
        log('[step2] change attempt: ' + JSON.stringify(report.step2.changeAttempt))

        await waitQuiet(page, 1500)
        var afterRoof = await page.locator(config.selectors.roofType).evaluate(function (el) {
          var o = el.options[el.selectedIndex]
          return o ? o.text.trim() : ''
        })
        report.step2.roofTypeAfter = afterRoof

        // Staleness: capture dependent dropdown labels after change
        report.step2.dependentSnapshot = await page.evaluate(function (sels) {
          function labelOf(sel) {
            var el = document.querySelector(sel)
            if (!el || el.tagName !== 'SELECT') return null
            var o = el.options[el.selectedIndex]
            return o ? (o.text || '').trim() : null
          }
          return {
            workType: labelOf(sels.workType),
            propertyType: labelOf(sels.propertyType),
            reroofPermitType: labelOf(sels.reroofPermitType),
            squares: (document.querySelector(sels.numberOfSquares) || {}).value || null,
          }
        }, {
          workType: config.selectors.workType,
          propertyType: config.selectors.propertyType,
          reroofPermitType: config.selectors.reroofPermitType,
          numberOfSquares: config.selectors.numberOfSquares,
        })

        report.step2.reuseWorks = !!(changed.ok && afterRoof && TEST.roofTypeChanged.test(afterRoof))
        report.step2.uiAllowedChange = changed.ok
        report.step2.lockedInOriginal = !!(beforeRoof && afterRoof && beforeRoof === afterRoof && TEST.roofTypeInitial.test(beforeRoof))

        var save2 = await clickSaveAndResume(page)
        report.step2.resave = save2
      }
    }

    await page.screenshot({ path: path.join(OUT_DIR, '04-step2-end.png'), fullPage: true }).catch(function () {})
  } catch (err) {
    report.error = err.message
    log('ERROR: ' + err.message)
    await page.screenshot({ path: path.join(OUT_DIR, 'error.png'), fullPage: true }).catch(function () {})
    if (/STOP: payment/i.test(err.message)) {
      try {
        report.paymentScreen = await page.evaluate(function () {
          var texts = Array.from(document.querySelectorAll('a, button, input, label, td, th, h1, h2, h3'))
            .map(function (el) { return (el.innerText || el.value || '').replace(/\s+/g, ' ').trim() })
            .filter(Boolean)
            .slice(0, 80)
          return { url: location.href, chrome: texts }
        })
      } catch (e) {}
    }
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'batch-c-step1-2.json'), JSON.stringify(report, null, 2))
    log('[done] wrote ' + path.join(OUT_DIR, 'batch-c-step1-2.json'))
    log('[done] draftsCreated=' + report.safety.draftsCreated + ' reuseWorks=' + report.step2.reuseWorks)
    await browser.close()
  }
}

main().catch(function (e) {
  console.error('FATAL:', e.message)
  process.exit(1)
})
