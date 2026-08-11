/**
 * Batch C Step 2 only — resume ONE existing draft and test roof-type reuse.
 * Does not create a new draft. Does not write to polk-county.config.js.
 *
 * Usage:
 *   BATCH_C_EXISTING_DRAFT=26TMP-043760 node scripts/diagnostics/polk-batch-c-step2-reuse.js
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
const EXISTING = process.env.BATCH_C_EXISTING_DRAFT || '26TMP-043760'
const STORAGE = path.join(OUT_DIR, 'storageState-polk-gator.json')

function log(msg) {
  console.log(msg)
  fs.appendFileSync(path.join(OUT_DIR, 'step2-run.log'), msg + '\n')
}

function abortIfPayment(page, report) {
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
    throw new Error('STOP: payment/cart surface reached')
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
  }).catch(function () {})
}

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) {
    log('[login] session valid')
    return
  }
  const frameHandle = await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 20000 })
  const frame = await frameHandle.contentFrame()
  await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
  await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
  log('[login] Solving reCAPTCHA…')
  const result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
  await frame.evaluate(function (token) {
    document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function (el) {
      el.style.display = 'block'
      el.value = token
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
  log('[login] OK')
}

async function resumeDraft(page, report) {
  await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await waitQuiet(page, 2500)
  await removeOverlay(page)

  var found = await page.evaluate(function (preferred) {
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim() }
    var out = []
    document.querySelectorAll('tr').forEach(function (tr, idx) {
      if (tr.querySelector('table')) return
      var text = clean(tr.innerText)
      if (!text || text.length > 350) return
      if (text.indexOf(preferred) === -1) return
      var resume = Array.from(tr.querySelectorAll('a')).some(function (a) {
        return /resume\s+application/i.test(clean(a.innerText || ''))
      })
      out.push({ idx: idx, altId: preferred, text: text.slice(0, 140), hasResume: resume })
    })
    return out.slice(0, 3)
  }, EXISTING)

  report.resumeCandidates = found
  log('[resume] candidates: ' + JSON.stringify(found))
  if (!found.length || !found[0].hasResume) {
    return { ok: false, reason: 'draft row / Resume not found' }
  }

  var row = page.locator('tr').filter({ hasText: EXISTING }).filter({ hasNot: page.locator('table') }).first()
  var resumeLink = row.locator('a').filter({ hasText: /Resume Application/i }).first()

  try {
    await Promise.all([
      page.waitForURL(/CapEdit|CapConfirm|CapCompleteness|Attachment|CapDetail/i, { timeout: 45000 }),
      resumeLink.click({ force: true }),
    ])
  } catch (e) {
    log('[resume] waitForURL failed: ' + e.message.slice(0, 100))
    await resumeLink.click({ force: true }).catch(function () {})
    for (var i = 0; i < 30; i++) {
      await page.waitForTimeout(1000)
      if (/CapEdit|CapConfirm|CapCompleteness|Attachment|CapDetail/i.test(page.url())) break
    }
  }

  await waitQuiet(page, 2500)
  abortIfPayment(page, report)
  var ok = /CapEdit|CapConfirm|CapCompleteness|Attachment|CapDetail/i.test(page.url())
  return { ok: ok, url: page.url(), reason: ok ? null : 'still on ' + page.url() }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'step2-run.log'), '')
  log('=== Batch C Step 2 only — reuse test on ' + EXISTING + ' ===')

  const report = {
    generatedAt: new Date().toISOString(),
    altId: EXISTING,
    safety: { draftsCreated: 0, submitted: false, paid: false },
    step2: {},
  }

  const svc = await import('../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)
  const solver = new Solver(process.env.TWOCAPTCHA_API_KEY)

  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
  const contextOpts = { viewport: { width: 1440, height: 900 } }
  if (fs.existsSync(STORAGE)) contextOpts.storageState = STORAGE
  const context = await browser.newContext(contextOpts)
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: STORAGE })

    var resumed = await resumeDraft(page, report)
    report.step2.resume = resumed
    if (!resumed.ok) throw new Error('Resume failed: ' + resumed.reason)
    log('[resume] OK → ' + page.url().replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]'))

    // Navigate to roof type page if needed
    for (var n = 0; n < 6; n++) {
      abortIfPayment(page, report)
      if (await page.locator(config.selectors.roofType).count()) break
      if (await page.locator(config.selectors.streetNo).count()) {
        log('[nav] Continue from location → detail')
        await removeOverlay(page)
        await page.locator('a, button, input').filter({ hasText: /Continue Application/i }).first().click({ force: true })
        await waitQuiet(page, 3000)
        continue
      }
      break
    }

    if (!(await page.locator(config.selectors.roofType).count())) {
      report.step2.failureMode = 'roof type control not found after resume'
      await page.screenshot({ path: path.join(OUT_DIR, '04-step2-end.png'), fullPage: true })
      throw new Error(report.step2.failureMode)
    }

    var beforeRoof = await page.locator(config.selectors.roofType).evaluate(function (el) {
      var o = el.options[el.selectedIndex]
      return o ? o.text.trim() : ''
    })
    report.step2.roofTypeBefore = beforeRoof
    log('[step2] roof before: ' + beforeRoof)

    var options = await page.locator(config.selectors.roofType + ' option').evaluateAll(function (opts) {
      return opts.map(function (o) { return { value: o.value, text: (o.text || '').trim() } })
        .filter(function (o) { return o.text && !/^--/.test(o.text) })
    })
    var metal = options.find(function (o) { return /metal/i.test(o.text) })
    if (!metal) throw new Error('Metal option missing: ' + JSON.stringify(options.map(function (o) { return o.text })))

    await page.selectOption(config.selectors.roofType, { value: metal.value }).catch(async function () {
      await page.selectOption(config.selectors.roofType, { label: metal.text })
    })
    await waitQuiet(page, 1500)

    var afterRoof = await page.locator(config.selectors.roofType).evaluate(function (el) {
      var o = el.options[el.selectedIndex]
      return o ? o.text.trim() : ''
    })
    report.step2.roofTypeAfter = afterRoof
    report.step2.optionLabels = options.map(function (o) { return o.text })
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

    report.step2.reuseWorks = /metal/i.test(afterRoof)
    report.step2.uiAllowedChange = true
    report.step2.lockedInOriginal = beforeRoof === afterRoof
    log('[step2] roof after: ' + afterRoof + ' reuseWorks=' + report.step2.reuseWorks)

    await removeOverlay(page)
    var saveSel = config.selectors.saveAndResumeBtn + ', a[onclick*="doSaveAndResume"], a:has-text("Save and Resume Later")'
    await page.click(saveSel, { force: true })
    await waitQuiet(page, 3000)
    report.step2.resaveUrl = page.url().replace(/capID[123]=[^&]+/gi, 'capID=[PRESENT]')
    await page.screenshot({ path: path.join(OUT_DIR, '04-step2-end.png'), fullPage: true })
  } catch (err) {
    report.error = err.message
    log('ERROR: ' + err.message)
    await page.screenshot({ path: path.join(OUT_DIR, 'error-step2.png'), fullPage: true }).catch(function () {})
  } finally {
    // Merge into batch-c-step1-2.json without wiping Step 1 findings
    var prior = {}
    var priorPath = path.join(OUT_DIR, 'batch-c-step1-2.json')
    if (fs.existsSync(priorPath)) {
      try { prior = JSON.parse(fs.readFileSync(priorPath, 'utf8')) } catch (e) {}
    }
    prior.step2 = Object.assign({}, prior.step2 || {}, report.step2)
    prior.step2OnlyRun = report
    prior.generatedAt = new Date().toISOString()
    fs.writeFileSync(priorPath, JSON.stringify(prior, null, 2))
    fs.writeFileSync(path.join(OUT_DIR, 'batch-c-step2.json'), JSON.stringify(report, null, 2))
    log('[done] reuseWorks=' + report.step2.reuseWorks)
    await browser.close()
  }
}

main().catch(function (e) {
  console.error('FATAL:', e.message)
  process.exit(1)
})
