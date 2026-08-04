/**
 * Read-only selector confirmation on an explicitly selected existing Polk draft.
 *
 * NO submit, no payment, no new draft, no save. This only resumes the existing
 * test draft and records DOM ids/names for visible wizard fields.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * AHJ_DISCOVERY_DRAFT_NUMBER, TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   AHJ_DISCOVERY_DRAFT_NUMBER=... TWOCAPTCHA_API_KEY=... \
 *   node scripts/diagnostics/ahj-discovery/polk-selector-confirmation.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.local') })

const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const config = require('../../../automation/ahjs/configs/polk-county.config.js')

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

const COMPANY_ID = requiredEnv('AHJ_DISCOVERY_COMPANY_ID')
const AHJ_ID = requiredEnv('AHJ_DISCOVERY_AHJ_ID')
const DRAFT_NUMBER = requiredEnv('AHJ_DISCOVERY_DRAFT_NUMBER')
const CAPTCHA_API_KEY = requiredEnv('TWOCAPTCHA_API_KEY')
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-selector-confirmation')
const STORAGE = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-c', 'storageState-polk-gator.json')

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

async function login(page, credentials, solver) {
  console.log('[login] opening portal')
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) {
    console.log('[login] existing session valid')
    return
  }
  console.log('[login] filling credentials')
  const frameHandle = await page.waitForSelector(config.selectors.loginIframe + ':not(.mask_iframe)', { timeout: 20000 })
  const frame = await frameHandle.contentFrame()
  if (!frame) throw new Error('Login iframe missing')
  await frame.fill(config.selectors.loginUsername, credentials.username)
  await frame.fill(config.selectors.loginPassword, credentials.password)
  console.log('[login] solving captcha')
  const result = await Promise.race([
    solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('2Captcha timed out')) }, 120000)
    }),
  ])
  console.log('[login] captcha solved')
  await frame.evaluate(function (token) {
    document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function (el) {
      el.style.display = 'block'
      el.value = token
    })
    function walk(o, d) {
      if (!o || d > 5) return
      try {
        if (typeof o === 'object') {
          Object.keys(o).forEach(function (k) {
            if (k === 'callback' && typeof o[k] === 'function') o[k](token)
            else walk(o[k], d + 1)
          })
        }
      } catch (e) {}
    }
    if (window.___grecaptcha_cfg) walk(window.___grecaptcha_cfg, 0)
  }, result.data)
  await page.waitForTimeout(1500)
  console.log('[login] submitting')
  await frame.evaluate(function () {
    document.querySelectorAll('button').forEach(function (b) {
      if ((b.textContent || '').includes('Sign In')) b.click()
    })
  })
  await page.waitForTimeout(5000)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(function () {})
  if (!/Dashboard\.aspx/i.test(page.url())) {
    await page.screenshot({ path: path.join(OUT_DIR, 'login-failed.png'), fullPage: true }).catch(function () {})
    var body = await page.locator('body').innerText({ timeout: 5000 }).catch(function () { return '' })
    throw new Error('Login did not reach Dashboard (url=' + page.url() + ', body=' + body.slice(0, 300) + ')')
  }
  console.log('[login] dashboard reached')
}

async function waitQuiet(page, ms) {
  await page.waitForTimeout(ms || 2000)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function () {})
}

async function clickContinue(page) {
  await page.getByText('Continue Application', { exact: false }).last().click({ timeout: 20000 })
  await waitQuiet(page, 2500)
}

async function resumeExistingDraft(page) {
  console.log('[resume] opening My Records')
  await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await waitQuiet(page, 5000)

  console.log('[resume] locating ' + DRAFT_NUMBER)
  const resumeMeta = await page.evaluate(function (altId) {
    var rows = Array.from(document.querySelectorAll('tr, .ACA_Grid_Row, .ACA_TabRow')).filter(function (row) {
      return (row.innerText || '').indexOf(altId) !== -1
    })
    for (var i = 0; i < rows.length; i++) {
      var controls = Array.from(rows[i].querySelectorAll('a, input, button'))
      for (var j = 0; j < controls.length; j++) {
        var el = controls[j]
        var text = (el.innerText || el.value || el.title || '').trim()
        var href = el.getAttribute('href') || ''
        var onclick = el.getAttribute('onclick') || ''
        if (/Resume Application/i.test(text + ' ' + href + ' ' + onclick)) {
          var m = (href + onclick).match(/__doPostBack\('([^']+)'/)
          return { found: true, text: text, href: href, onclick: onclick, eventTarget: m ? m[1] : null }
        }
      }
    }
    return { found: false }
  }, DRAFT_NUMBER)

  if (!resumeMeta.found) throw new Error('Resume Application control not found for ' + DRAFT_NUMBER)
  console.log('[resume] resume control found, eventTarget=' + (resumeMeta.eventTarget || 'none'))

  if (resumeMeta.eventTarget) {
    await page.evaluate(function (target) {
      if (typeof window.__doPostBack === 'function') {
        window.__doPostBack(target, '')
        return
      }
      var form = document.getElementById('aspnetForm') || document.forms[0]
      if (!form) throw new Error('aspnetForm missing')
      var et = form.querySelector('input[name="__EVENTTARGET"]')
      if (!et) {
        et = document.createElement('input')
        et.name = '__EVENTTARGET'
        et.type = 'hidden'
        form.appendChild(et)
      }
      et.value = target
      form.submit()
    }, resumeMeta.eventTarget)
  } else {
    await page.getByText('Resume Application', { exact: false }).first().click()
  }

  console.log('[resume] waiting for modal or CapEdit')
  await waitForResumeModalOrCapEdit(page)
  console.log('[resume] handling modal if present')
  await handleResumeModal(page)
  await page.waitForURL('**/CapEdit.aspx**', { timeout: 60000 }).catch(function () {})
  await waitQuiet(page, 3000)
  console.log('[resume] CapEdit url=' + page.url())
}

async function waitForResumeModalOrCapEdit(page) {
  for (var i = 0; i < 80; i++) {
    var state = await page.evaluate(function () {
      var layer = document.getElementById('dvACADialogLayer')
      var text = layer ? (layer.innerText || '') : ''
      return {
        url: location.href,
        modal: /Select Application Page Flow Step|Pick up where I left off|Start from the beginning/i.test(text),
        capEdit: /CapEdit\.aspx/i.test(location.href),
      }
    }).catch(function () {
      return { navigating: true, url: page.url() }
    })
    if (state.modal || state.capEdit) return state
    await page.waitForTimeout(500)
  }
  throw new Error('Resume modal / CapEdit not reached, url=' + page.url())
}

async function handleResumeModal(page) {
  var hasModal = await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    return !!(layer && /Select Application Page Flow Step|Pick up where I left off|Start from the beginning/i.test(layer.innerText || ''))
  })
  if (!hasModal) return

  // Start from the beginning so every wizard page is visible for read-only DOM inspection.
  await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    var radios = Array.from(layer.querySelectorAll('input[type="radio"]'))
    var start = radios[0]
    radios.forEach(function (r) {
      var root = r.closest('tr, td, div') || r.parentElement
      if (/Start from the beginning/i.test(root ? root.innerText || '' : '')) start = r
    })
    if (start) start.click()
    var ok = Array.from(layer.querySelectorAll('a, button, input')).find(function (el) {
      return /^OK$/i.test((el.innerText || el.value || '').trim())
    })
    if (ok) ok.click()
  })
  await waitQuiet(page, 3000)
}

async function collectControls(page, label) {
  var controls = await page.evaluate(function () {
    function contextFor(el) {
      var node = el
      for (var i = 0; i < 6 && node; i++) {
        if (node.tagName === 'TR') return (node.innerText || '').replace(/\s+/g, ' ').trim()
        node = node.parentElement
      }
      node = el.parentElement
      for (var j = 0; j < 4 && node; j++) {
        var text = (node.innerText || '').replace(/\s+/g, ' ').trim()
        if (text && text.length < 500) return text
        node = node.parentElement
      }
      return ''
    }
    return Array.from(document.querySelectorAll('input, select, textarea')).map(function (el) {
      var selected = ''
      if (el.tagName === 'SELECT' && el.options && el.selectedIndex >= 0) {
        selected = (el.options[el.selectedIndex].text || '').trim()
      }
      var options = []
      if (el.tagName === 'SELECT') {
        options = Array.from(el.options).map(function (o) { return (o.text || '').trim() }).filter(Boolean)
      }
      return {
        id: el.id || null,
        name: el.name || null,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        value: el.value || '',
        selected: selected,
        checked: !!el.checked,
        options: options,
        context: contextFor(el),
      }
    })
  })
  await page.screenshot({ path: path.join(OUT_DIR, label + '.png'), fullPage: true })
  return { label: label, url: page.url(), controls: controls }
}

function findRelevant(snapshot) {
  var patterns = {
    applicantOwner: /Is the Applicant the Owner/i,
    virtualInspections: /Would you like inspections.*virtually/i,
    privateProvider: /Private Provider.*Plans Review|Plans Review or Inspections/i,
    constructionWaste: /Construction Waste Acknowledgement/i,
    franchiseName: /Commercial Franchise Holder Name/i,
    franchisePhone: /Commercial Franchise Holder Phone/i,
    disposalEquipment: /Disposal Equipment/i,
    disposalFrequency: /Disposal Frequency/i,
    codeViolationCaseNumber: /Code Violation Case Number/i,
    jobDescription: /Job Description/i,
    jobValue: /Job Value/i,
    planUploadAcknowledgement: /PLAN UPLOAD ACKNOWLEDGEMENT|I acknowledge that I will upload plans/i,
  }
  var out = {}
  Object.keys(patterns).forEach(function (key) {
    out[key] = snapshot.controls.filter(function (c) {
      return patterns[key].test(c.context || '')
    })
  })
  return out
}

async function main() {
  ensureOut()
  console.log('[main] loading credentials')
  const mod = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await mod.getCredentials(COMPANY_ID, AHJ_ID)
  const solver = new Solver(CAPTCHA_API_KEY)

  console.log('[main] launching browser')
  const contextOptions = fs.existsSync(STORAGE) ? { storageState: STORAGE } : {}
  const browser = await chromium.launch({ headless: true, slowMo: 150 })
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  page.setDefaultTimeout(45000)

  var report = {
    generatedAt: new Date().toISOString(),
    altId: DRAFT_NUMBER,
    safety: { submitted: false, paid: false, draftsCreated: 0, saved: false },
    snapshots: [],
    relevant: {},
  }

  try {
    await login(page, credentials, solver)
    await resumeExistingDraft(page)
    console.log('[inspect] page 1')
    report.snapshots.push(await collectControls(page, '01-location-information'))

    console.log('[inspect] page 2 permit information')
    await clickContinue(page)
    var permitInfo = await collectControls(page, '02-permit-information')
    report.snapshots.push(permitInfo)
    report.relevant.permitInformation = findRelevant(permitInfo)

    console.log('[inspect] page 3 primary LP')
    await clickContinue(page)
    report.snapshots.push(await collectControls(page, '03-primary-lp'))

    console.log('[inspect] page 4 subcontractors')
    await clickContinue(page)
    report.snapshots.push(await collectControls(page, '04-subcontractors'))

    console.log('[inspect] page 5 permit detail')
    await clickContinue(page)
    var permitDetail = await collectControls(page, '05-permit-detail')
    report.snapshots.push(permitDetail)
    report.relevant.permitDetail = findRelevant(permitDetail)

    console.log('[inspect] page 6 documents')
    await clickContinue(page)
    var documents = await collectControls(page, '06-documents')
    report.snapshots.push(documents)
    report.relevant.documents = findRelevant(documents)

    fs.writeFileSync(path.join(OUT_DIR, 'selector-confirmation.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report.relevant, null, 2))
    console.log('[done] report tmp/polk-selector-confirmation/selector-confirmation.json')
  } finally {
    await context.close().catch(function () {})
    await browser.close().catch(function () {})
  }
}

main().catch(function (err) {
  console.error('[selector-confirmation] FAILED:', err.stack || err.message)
  process.exit(1)
})
