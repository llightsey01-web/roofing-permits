/**
 * Read-only discovery of Polk CapDetail / AttachmentsList.aspx upload controls.
 *
 * NO upload, no Browse/Add click that starts a file picker when avoidable, no
 * payment, no CapEdit, no Mark Issued. Locates and records DOM ids only.
 *
 * Requires an already-submitted Accela record number (not a 26TMP draft, not
 * jobs.permit_number from Mark Permit Issued unless that happens to equal the
 * Accela alt ID — prefer the portal alt ID from the submitted package).
 *
 * Required env:
 *   AHJ_DISCOVERY_COMPANY_ID
 *   AHJ_DISCOVERY_AHJ_ID
 *   AHJ_DISCOVERY_PORTAL_RECORD_NUMBER  (submitted CapDetail alt ID)
 *   TWOCAPTCHA_API_KEY
 *
 * Usage:
 *   AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   AHJ_DISCOVERY_PORTAL_RECORD_NUMBER=BT-... TWOCAPTCHA_API_KEY=... \
 *   node scripts/diagnostics/ahj-discovery/polk-attachments-discovery.js
 *
 * Do NOT run against live records without explicit founder go-ahead.
 */
'use strict'

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.local') })

const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const config = require('../../../automation/ahjs/configs/polk-county.config.js')

function requiredEnv(name) {
  const value = process.env[name] && String(process.env[name]).trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

const COMPANY_ID = requiredEnv('AHJ_DISCOVERY_COMPANY_ID')
const AHJ_ID = requiredEnv('AHJ_DISCOVERY_AHJ_ID')
const RECORD_NUMBER = requiredEnv('AHJ_DISCOVERY_PORTAL_RECORD_NUMBER')
const CAPTCHA_API_KEY = requiredEnv('TWOCAPTCHA_API_KEY')
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-attachments-discovery')

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) return
  const frameHandle = await page.waitForSelector(config.selectors.loginIframe + ':not(.mask_iframe)', { timeout: 20000 })
  const frame = await frameHandle.contentFrame()
  if (!frame) throw new Error('Login iframe missing')
  await frame.fill(config.selectors.loginUsername, credentials.username)
  await frame.fill(config.selectors.loginPassword, credentials.password)
  const result = await Promise.race([
    solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl),
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('2Captcha timed out')) }, 120000)
    }),
  ])
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
  await frame.evaluate(function () {
    document.querySelectorAll('button').forEach(function (b) {
      if ((b.textContent || '').includes('Sign In')) b.click()
    })
  })
  await page.waitForTimeout(5000)
  if (!/Dashboard\.aspx/i.test(page.url())) {
    throw new Error('Login did not reach Dashboard: ' + page.url())
  }
}

async function openCapDetail(page, recordNumber) {
  await page.goto(config.selectors.myRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  const opened = await page.evaluate(function (expectedRaw) {
    function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim() }
    var expected = expectedRaw.toUpperCase()
    var rows = Array.from(document.querySelectorAll('table[id$="gdvPermitList"] tr, tr.ACA_Grid_Row, tr'))
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (clean(row.innerText).toUpperCase().indexOf(expected) < 0) continue
      var links = Array.from(row.querySelectorAll('a'))
      var detail = links.find(function (a) {
        var href = String(a.getAttribute('href') || '')
        var label = clean(a.innerText)
        if (/Resume Application/i.test(label)) return false
        return /CapDetail\.aspx/i.test(href) || label.toUpperCase() === expected
      })
      if (!detail) return { ok: false, reason: 'no_capdetail_link' }
      detail.click()
      return { ok: true }
    }
    return { ok: false, reason: 'record_not_found' }
  }, recordNumber)
  if (!opened.ok) throw new Error('Could not open CapDetail: ' + opened.reason)
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(function () {})
  await page.waitForTimeout(2000)
  if (/CapEdit\.aspx|ShoppingCart/i.test(page.url())) {
    throw new Error('Refusing to continue — landed on CapEdit/cart: ' + page.url())
  }
}

async function scanAttachmentsSurface(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null
    }
    var provisional = {
      attachmentsTab: document.querySelector('a[data-control="tab-attachments"]'),
      selectFromAccount: document.querySelector('#ctl00_PlaceHolderMain_attachmentEdit_btnSelectFromAccount'),
      browseAdd: document.querySelector('#ctl00_PlaceHolderMain_attachmentEdit_btnBrowse'),
      fileInput: document.querySelector('#fileInput_ctl00_PlaceHolderMain_attachmentEdit_divHtml5Upload'),
    }
    var fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(function (el) {
      return {
        id: el.id || null,
        name: el.name || null,
        accept: el.accept || null,
        visible: visible(el),
        className: el.className || null,
      }
    })
    var uploadish = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
      .filter(function (el) {
        var t = ((el.innerText || el.value || '') + ' ' + (el.id || '')).toLowerCase()
        return /upload|browse|attach|add file|select from account|html5/i.test(t)
      })
      .slice(0, 40)
      .map(function (el) {
        return {
          tag: el.tagName,
          id: el.id || null,
          text: String(el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          visible: visible(el),
        }
      })

    return {
      url: location.href,
      title: document.title || null,
      provisional: {
        attachmentsTab: provisional.attachmentsTab
          ? { id: provisional.attachmentsTab.id || null, visible: visible(provisional.attachmentsTab) }
          : null,
        selectFromAccount: provisional.selectFromAccount
          ? { id: provisional.selectFromAccount.id, visible: visible(provisional.selectFromAccount) }
          : null,
        browseAdd: provisional.browseAdd
          ? { id: provisional.browseAdd.id, visible: visible(provisional.browseAdd) }
          : null,
        fileInput: provisional.fileInput
          ? { id: provisional.fileInput.id, visible: visible(provisional.fileInput) }
          : null,
      },
      fileInputs: fileInputs,
      uploadishControls: uploadish,
      isAttachmentsList: /AttachmentsList\.aspx/i.test(location.href),
      isCapDetail: /CapDetail\.aspx/i.test(location.href),
      isCapEdit: /CapEdit\.aspx/i.test(location.href),
      isPayment: /ShoppingCart|Pay Fees|Forte/i.test(location.href + ' ' + (document.body.innerText || '').slice(0, 2000)),
    }
  })
}

async function main() {
  ensureOut()
  console.log('[polk-attachments-discovery] READ-ONLY — record=', RECORD_NUMBER)
  console.log('[polk-attachments-discovery] Will NOT upload files or click payment controls')

  if (/^26TMP/i.test(RECORD_NUMBER)) {
    console.warn('[warn] Record looks like a draft (26TMP-*). Post-submit upload needs a submitted CapDetail record.')
  }

  const mod = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await mod.getCredentials(COMPANY_ID, AHJ_ID)
  const solver = new Solver(CAPTCHA_API_KEY)
  const browser = await chromium.launch({ headless: true, slowMo: 200 })
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(45000)

  const findings = {
    safety: {
      uploaded: false,
      browsedFilePicker: false,
      paid: false,
      clickedResume: false,
      confirmedForRoofingPermit: false,
    },
    recordNumber: RECORD_NUMBER,
    capDetail: null,
    afterAttachmentsTab: null,
  }

  try {
    await login(page, credentials, solver)
    await openCapDetail(page, RECORD_NUMBER)
    findings.capDetail = await scanAttachmentsSurface(page)
    await page.screenshot({
      path: path.join(OUT_DIR, 'capdetail.png'),
      fullPage: true,
    }).catch(function () {})

    if (findings.capDetail.isPayment || findings.capDetail.isCapEdit) {
      throw new Error('Unsafe surface after open — aborting discovery')
    }

    const tab = page.locator('a[data-control="tab-attachments"]').first()
    if (await tab.count()) {
      await tab.click({ timeout: 15000 })
      await page.waitForTimeout(2500)
      findings.afterAttachmentsTab = await scanAttachmentsSurface(page)
      await page.screenshot({
        path: path.join(OUT_DIR, 'attachments-tab.png'),
        fullPage: true,
      }).catch(function () {})
    } else {
      findings.afterAttachmentsTab = { error: 'attachments_tab_not_found' }
    }

    const outPath = path.join(OUT_DIR, 'attachments-discovery.json')
    fs.writeFileSync(outPath, JSON.stringify(findings, null, 2))
    console.log('[polk-attachments-discovery] Wrote', outPath)
    console.log('[polk-attachments-discovery] provisional fileInput:',
      findings.afterAttachmentsTab &&
      findings.afterAttachmentsTab.provisional &&
      findings.afterAttachmentsTab.provisional.fileInput)
    console.log('[polk-attachments-discovery] DONE — review JSON before flipping confirmedForRoofingPermit')
  } finally {
    await context.close().catch(function () {})
    await browser.close().catch(function () {})
  }
}

main().catch(function (err) {
  console.error('[polk-attachments-discovery] FAILED:', err.message)
  process.exit(1)
})
