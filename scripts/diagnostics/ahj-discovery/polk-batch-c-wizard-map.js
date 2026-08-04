/**
 * Batch C — resume modal fix, wizard field map, reuse test for one explicit draft.
 *
 * STEP 1: Resume + "Pick up where I left off" page-flow modal → CapEdit wizard
 * STEP 2: Read-only walk — Location & People → Permit Detail → Documents → Review (stop before Record Issuance)
 * STEP 3: Change roof shingle→metal, save, resume, verify persistence
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * AHJ_DISCOVERY_DRAFT_NUMBER, TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   AHJ_DISCOVERY_DRAFT_NUMBER=... TWOCAPTCHA_API_KEY=... \
 *   node scripts/diagnostics/ahj-discovery/polk-batch-c-wizard-map.js
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
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-c')
const STORAGE = path.join(OUT_DIR, 'storageState-polk-gator.json')

const BLOCKED = /submit(\s|$)|pay(\s|$|ment)|checkout|delete|cancel\s+(permit|application)|schedule\s+inspection/i

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function log(msg) {
  console.log(msg)
  fs.appendFileSync(path.join(OUT_DIR, 'wizard-run.log'), msg + '\n')
}

function redactUrl(u) {
  return String(u || '')
    .replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]')
    .replace(/(altId=)[^&]+/i, '$1[PRESENT]')
}

function abortIfPayment(page, report) {
  const u = (page.url() || '').toLowerCase()
  if (/\/shoppingcart\//i.test(u) || /\/payment\//i.test(u) || /pay\.aspx/i.test(u) || /checkout\.aspx/i.test(u)) {
    report.stoppedAtPayment = true
    report.paymentUrl = page.url()
    throw new Error('STOP: payment/cart surface')
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

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) {
    log('[login] session valid')
    return
  }
  const frame = await (await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 20000 })).contentFrame()
  await frame.fill(config.selectors.loginUsername, credentials.username)
  await frame.fill(config.selectors.loginPassword, credentials.password)
  log('[login] Solving reCAPTCHA…')
  const result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
  await frame.evaluate(function (token) {
    document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function (el) {
      el.style.display = 'block'
      el.value = token
    })
    var walk = function (o, d) {
      d = d || 0
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
    if (window.___grecaptcha_cfg) walk(window.___grecaptcha_cfg)
  }, result.data)
  await page.waitForTimeout(1500)
  await frame.evaluate(function () {
    document.querySelectorAll('button').forEach(function (b) {
      if ((b.textContent || '').includes('Sign In')) b.click()
    })
  })
  await page.waitForURL('**/Dashboard.aspx**', { timeout: 60000 })
  log('[login] OK')
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
        modalText: modalText.slice(0, 200),
      }
    })
    if (state.capEdit) return { kind: 'capEdit', state: state }
    if (state.modal) return { kind: 'modal', state: state }
    await page.waitForTimeout(500)
  }
  return { kind: 'timeout', state: { url: page.url() } }
}

async function handleResumePageFlowModal(page) {
  log('[modal] waiting for Resume Application page-flow dialog…')
  var waited = await waitForResumeModalOrCapEdit(page, 30000)
  if (waited.kind === 'capEdit') {
    log('[modal] CapEdit reached without modal (direct navigation)')
    return { skipped: true }
  }
  if (waited.kind !== 'modal') {
    throw new Error('Resume page-flow modal not detected (url=' + page.url() + ')')
  }

  var modalInfo = await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    return { text: (layer.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) }
  })
  log('[modal] ' + JSON.stringify(modalInfo))

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
  if (!picked) throw new Error('Could not select "Pick up where I left off" radio')

  var okClicked = await page.evaluate(function () {
    var layer = document.getElementById('dvACADialogLayer')
    if (!layer) return false
    var btn = Array.from(layer.querySelectorAll('a, button, input[type="button"], input[type="submit"]')).find(function (el) {
      var t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim()
      return /^OK$/i.test(t)
    })
    if (!btn) return false
    btn.click()
    return true
  })
  if (!okClicked) {
    await page.locator('#dvACADialogLayer a, #dvACADialogLayer button, #dvACADialogLayer input').filter({ hasText: /^OK$/i }).first().click({ force: true })
  }
  log('[modal] selected Pick up where I left off + clicked OK')
  await waitQuiet(page, 4000)

  await page.waitForURL(/CapEdit\.aspx/i, { timeout: 45000 })
  await waitQuiet(page, 2500)
  return { skipped: false }
}

async function clickResumeOnDraft(page, altId) {
  await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await waitQuiet(page, 2500)

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
    if (m) return { btnId: a.id, postTarget: m[1].replace(/\\'/g, "'") }
    return { btnId: a.id, postTarget: null }
  }, altId)

  if (!postTarget || !postTarget.postTarget) throw new Error('Resume Application postback target not found for ' + altId)
  log('[resume] postback via #' + postTarget.btnId)

  await aspNetPostBack(page, postTarget.postTarget)
  var modalResult = await handleResumePageFlowModal(page)

  return { ok: true, url: page.url(), btnId: postTarget.btnId, postTarget: postTarget.postTarget, modal: modalResult }
}

async function getWizardContext(page) {
  return page.evaluate(function () {
    var body = document.body ? document.body.innerText : ''
    var stepMatch = body.match(/Step\s+\d+\s*:\s*[^\n]+/i)
    var subMatch = body.match(/Step\s+\d+\s*:\s*[^\n>]+>\s*[^\n]+/i)
    var progress = Array.from(document.querySelectorAll('.ACA_Step, .step, li, span, div'))
      .map(function (el) { return (el.innerText || '').replace(/\s+/g, ' ').trim() })
      .filter(function (t) {
        return /Location|Permit Detail|Documents|Review|Record Issuance|Location & People/i.test(t) && t.length < 80
      })
      .slice(0, 12)
    return {
      wizardStepLine: stepMatch ? stepMatch[0].trim() : null,
      wizardSubLine: subMatch ? subMatch[0].trim() : null,
      progressHints: progress,
    }
  })
}

async function captureDetailedFields(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      return el.getBoundingClientRect().width > 0
    }
    function labelFor(el) {
      if (el.id) {
        var lab = document.querySelector('label[for="' + el.id + '"]')
        if (lab) return (lab.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140)
      }
      var tr = el.closest('tr')
      if (tr) {
        var cells = Array.from(tr.querySelectorAll('td'))
        var fieldCell = el.closest('td')
        var labelCell = cells.find(function (c) { return c !== fieldCell && (c.innerText || '').trim().length > 0 })
        if (labelCell) return labelCell.innerText.replace(/\s+/g, ' ').trim().slice(0, 140)
      }
      return null
    }
    function requiredField(el) {
      if (el.required) return true
      var tr = el.closest('tr')
      if (tr && (tr.innerHTML.indexOf('ACA_Required') !== -1 || tr.innerHTML.indexOf('required') !== -1)) return true
      var lab = labelFor(el) || ''
      return /\*/.test(lab)
    }
    var sections = Array.from(document.querySelectorAll('h2, h3, .ACA_Title_Bar, .ACA_SectionTitle, .portlet_title, .ACA_SubTitle'))
      .filter(visible)
      .map(function (el) { return el.innerText.replace(/\s+/g, ' ').trim() })
      .filter(Boolean)
      .slice(0, 25)

    var fields = []
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden') return
      if (!visible(el)) return
      if (el.closest('table[id*="gdvPermitList"]')) return
      var entry = {
        id: el.id || null,
        name: el.name || null,
        label: labelFor(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        required: requiredField(el),
      }
      if (el.tagName === 'SELECT') {
        entry.options = Array.from(el.options).map(function (o) { return (o.text || '').trim() })
          .filter(function (t) { return t && !/^--/.test(t) })
          .slice(0, 50)
        var opt = el.options[el.selectedIndex]
        entry.value = opt ? (opt.text || '').trim() : ''
      } else if (el.type === 'radio' || el.type === 'checkbox') {
        entry.checked = el.checked
        entry.value = el.value || ''
      } else {
        entry.value = String(el.value || '').slice(0, 100)
      }
      fields.push(entry)
    })
    return { sections: sections, fields: fields, fieldCount: fields.length }
  })
}

async function captureScreen(page, tag) {
  var ctx = await getWizardContext(page)
  var detail = await captureDetailedFields(page)
  var shot = path.join(OUT_DIR, 'wizard-' + tag + '.png')
  await page.screenshot({ path: shot, fullPage: true }).catch(function () {})
  return {
    tag: tag,
    url: redactUrl(page.url()),
    wizard: ctx,
    sections: detail.sections,
    fields: detail.fields,
    fieldCount: detail.fieldCount,
    screenshot: path.basename(shot),
  }
}

function shouldStopBeforeAdvance(pageText, wizardStepLine) {
  var blob = (pageText + ' ' + (wizardStepLine || '')).toLowerCase()
  if (/record issuance|payment|checkout|pay now|fee payment|shopping cart/i.test(blob)) return true
  return false
}

async function clickNav(page, re, label) {
  var btn = page.locator('a, button, input[type="button"], input[type="submit"]').filter({ hasText: re }).first()
  if (!(await btn.count())) return false
  var text = await btn.innerText().catch(function () { return '' })
  if (BLOCKED.test(text)) throw new Error('Blocked control: ' + text)
  log('[nav] ' + label + ': ' + text.replace(/\s+/g, ' ').trim().slice(0, 50))
  await btn.click({ force: true })
  await waitQuiet(page, 3500)
  return true
}

async function walkWizardReadOnly(page, report) {
  var screens = []
  var seen = {}

  async function snap(tag) {
    var s = await captureScreen(page, tag)
    var key = (s.wizard.wizardStepLine || '') + '|' + s.fieldCount + '|' + s.url
    if (seen[key]) return false
    seen[key] = true
    screens.push(s)
    log('[map] ' + tag + ' — ' + (s.wizard.wizardStepLine || '(no step line)') + ' fields=' + s.fieldCount)
    return true
  }

  await snap('00-resume-landing')

  // Map backward first (Permit Information → Location Information, etc.)
  for (var back = 0; back < 4; back++) {
    if (!(await clickNav(page, /Previous|Back/i, 'previous'))) break
    abortIfPayment(page, report)
    await snap('back-' + (back + 1))
  }

  // Walk forward through wizard
  for (var fwd = 0; fwd < 8; fwd++) {
    abortIfPayment(page, report)
    var bodyText = await page.innerText('body').catch(function () { return '' })
    var ctx = await getWizardContext(page)
    if (shouldStopBeforeAdvance(bodyText, ctx.wizardStepLine)) {
      log('[map] stop before advance — Record Issuance/payment surface detected')
      report.wizardStopReason = 'Record Issuance or payment detected — did not Continue'
      break
    }
    if (/Review/i.test(ctx.wizardStepLine || '') || /Review/i.test(bodyText.slice(0, 500))) {
      await snap('review-final')
      log('[map] captured Review — stopping before Record Issuance')
      report.wizardStopReason = 'Stopped after Review capture'
      break
    }
    if (!(await clickNav(page, /Continue Application/i, 'continue'))) break
    await snap('fwd-' + (fwd + 1))
    var afterCtx = await getWizardContext(page)
    var afterBody = await page.innerText('body').catch(function () { return '' })
    if (/Documents/i.test(afterCtx.wizardStepLine || '') || /Attach|Upload|Document/i.test(afterBody.slice(0, 800))) {
      // one more continue might hit review
      continue
    }
  }

  report.wizardScreens = screens
  return screens
}

async function navigateToRoofType(page) {
  for (var i = 0; i < 8; i++) {
    if (await page.locator(config.selectors.roofType).count()) return true
    if (await page.locator(config.selectors.streetNo).count()) {
      await clickNav(page, /Continue Application/i, 'continue-to-detail')
      continue
    }
    if (await clickNav(page, /Previous|Back|Permit Detail|Location/i, 'back-to-detail')) continue
    break
  }
  return !!(await page.locator(config.selectors.roofType).count())
}

async function readRoofType(page) {
  if (!(await page.locator(config.selectors.roofType).count())) return null
  return page.locator(config.selectors.roofType).evaluate(function (el) {
    var o = el.options[el.selectedIndex]
    return o ? o.text.trim() : ''
  })
}

async function selectRoofMetal(page) {
  await page.selectOption(config.selectors.roofType, { label: 'Metal' }).catch(async function () {
    await page.evaluate(function (sel) {
      var el = document.querySelector(sel)
      if (!el) return
      var opt = Array.from(el.options).find(function (o) { return /metal/i.test(o.text || '') })
      if (opt) {
        el.value = opt.value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, config.selectors.roofType)
  })
  await waitQuiet(page, 1500)
}

async function dependentSnapshot(page) {
  return page.evaluate(function (sels) {
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
}

async function saveAndResume(page) {
  var urlBefore = page.url()
  await page.click(
    config.selectors.saveAndResumeBtn + ', a[onclick*="doSaveAndResume"], a:has-text("Save and Resume Later")',
    { force: true }
  )
  await waitQuiet(page, 4000)
  return { urlBefore: redactUrl(urlBefore), urlAfter: redactUrl(page.url()) }
}

function diffFieldSets(beforeFields, afterFields) {
  var beforeIds = new Set((beforeFields || []).map(function (f) { return f.id || f.name }).filter(Boolean))
  var afterIds = new Set((afterFields || []).map(function (f) { return f.id || f.name }).filter(Boolean))
  var added = []
  var removed = []
  afterIds.forEach(function (id) { if (!beforeIds.has(id)) added.push(id) })
  beforeIds.forEach(function (id) { if (!afterIds.has(id)) removed.push(id) })
  return { added: added.slice(0, 30), removed: removed.slice(0, 30) }
}

async function main() {
  ensureOut()
  fs.writeFileSync(path.join(OUT_DIR, 'wizard-run.log'), '')
  log('=== Batch C wizard map + reuse === draft ' + DRAFT_NUMBER)

  const report = {
    generatedAt: new Date().toISOString(),
    altId: DRAFT_NUMBER,
    safety: { submitted: false, paid: false, draftsCreated: 0 },
    step1ResumeFix: {},
    wizardScreens: [],
    step3Reuse: {},
  }

  const svc = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)
  const solver = new Solver(CAPTCHA_API_KEY)

  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
  const contextOpts = { viewport: { width: 1440, height: 900 } }
  if (fs.existsSync(STORAGE)) contextOpts.storageState = STORAGE
  const context = await browser.newContext(contextOpts)
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: STORAGE })

    // STEP 1 — resume with page-flow modal
    var resume1 = await clickResumeOnDraft(page, DRAFT_NUMBER)
    report.step1ResumeFix = resume1
    var landing = await getWizardContext(page)
    report.step1ResumeFix.landing = landing
    log('[step1] landed: ' + JSON.stringify(landing))
    var landingOk = /Location|Permit Information|Permit Detail|Custom Fields/i.test(
      (landing.wizardStepLine || '') + (landing.wizardSubLine || '')
    ) || /Permit Information|Custom Fields|Roof Type/i.test(await page.innerText('body').catch(function () { return '' }))
    report.step1ResumeFix.reachedWizard = landingOk
    if (!landingOk) throw new Error('Resume did not reach expected wizard screen')

    // STEP 2 — read-only wizard map
    await walkWizardReadOnly(page, report)

    // STEP 3 — reuse: shingle → metal on same draft
    log('[step3] resume again for reuse test…')
    var resume2 = await clickResumeOnDraft(page, DRAFT_NUMBER)
    report.step3Reuse.secondResume = resume2

    var onRoof = await navigateToRoofType(page)
    if (!onRoof) throw new Error('Could not reach roof type control for reuse test')

    var beforeRoof = await readRoofType(page)
    var fieldsBeforeChange = (await captureDetailedFields(page)).fields
    log('[step3] roof before change: ' + beforeRoof)

    await selectRoofMetal(page)
    var afterRoofImmediate = await readRoofType(page)
    var fieldsAfterChange = (await captureDetailedFields(page)).fields
    var depsAfter = await dependentSnapshot(page)
    var fieldDiff = diffFieldSets(fieldsBeforeChange, fieldsAfterChange)

    report.step3Reuse.roofTypeBefore = beforeRoof
    report.step3Reuse.roofTypeAfterChange = afterRoofImmediate
    report.step3Reuse.uiAllowedChange = /metal/i.test(afterRoofImmediate || '')
    report.step3Reuse.dependentAfterChange = depsAfter
    report.step3Reuse.conditionalFieldDiff = fieldDiff
    log('[step3] roof after change (same session): ' + afterRoofImmediate)

    var save1 = await saveAndResume(page)
    report.step3Reuse.saveAfterChange = save1

    log('[step3] third resume — verify persistence…')
    var resume3 = await clickResumeOnDraft(page, DRAFT_NUMBER)
    report.step3Reuse.verifyResume = resume3
    await navigateToRoofType(page)
    var afterReopen = await readRoofType(page)
    var depsReopen = await dependentSnapshot(page)

    report.step3Reuse.roofTypeAfterReopen = afterReopen
    report.step3Reuse.dependentAfterReopen = depsReopen
    report.step3Reuse.reuseWorks = /metal/i.test(afterReopen || '')
    report.step3Reuse.lockedInOriginal = !!(beforeRoof && afterReopen && beforeRoof === afterRoof && /shingle/i.test(beforeRoof))

    log('[step3] FINAL reuseWorks=' + report.step3Reuse.reuseWorks + ' lockedInOriginal=' + report.step3Reuse.lockedInOriginal)
    log('[step3] before=' + beforeRoof + ' afterReopen=' + afterReopen)

    var verifySave = await saveAndResume(page)
    report.step3Reuse.saveAfterVerify = verifySave
  } catch (err) {
    report.error = err.message
    log('ERROR: ' + err.message)
    await page.screenshot({ path: path.join(OUT_DIR, 'wizard-error.png'), fullPage: true }).catch(function () {})
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'batch-c-wizard-map.json'), JSON.stringify(report, null, 2))
    log('[done] wrote batch-c-wizard-map.json')
    await browser.close()
  }
}

main().catch(function (e) {
  console.error('FATAL:', e.message)
  process.exit(1)
})
