/**
 * View-only inspection of one explicitly selected Polk record.
 *
 * NEVER click Respond / Edit / Resume / Upload / Submit / Pay / Delete.
 * If a response action exists, capture label+locator only — do not activate it.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * AHJ_DISCOVERY_RECORD_NUMBER, TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   AHJ_DISCOVERY_RECORD_NUMBER=... TWOCAPTCHA_API_KEY=... \
 *   node scripts/diagnostics/ahj-discovery/polk-correction-inspect.js
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
const TARGET_RECORD_NUMBER = requiredEnv('AHJ_DISCOVERY_RECORD_NUMBER')
const CAPTCHA_API_KEY = requiredEnv('TWOCAPTCHA_API_KEY')
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-correction-inspect')
const STORAGE_CANDIDATES = [
  path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a2', 'storageState-polk-gator.json'),
  path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-b', 'storageState-polk-gator.json'),
  path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a', 'storageState-polk-gator.json'),
]

/** Do not activate these — locate only */
const FORBIDDEN_CLICK = [
  /respond/i,
  /\bedit\b/i,
  /resume/i,
  /upload/i,
  /submit/i,
  /pay(\s|$|ment)/i,
  /checkout/i,
  /\bdelete\b/i,
  /cancel\s+(permit|application|record)/i,
  /schedule/i,
  /save(\s|$)/i,
  /continue\s+application/i,
  /i\s+(agree|accept)/i,
  /send\s+(email|notification)/i,
  /add\s+to\s+cart/i,
]

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function redact(s) {
  return String(s || '')
    .replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[RECORD_REDACTED]')
    .replace(/capID[123]=[^&\s"']+/gi, 'capID=[REDACTED]')
    .replace(/\b\d{1,5}\s+[A-Z][A-Za-z0-9.'-]+(?:\s+[A-Z][A-Za-z0-9.'-]+){0,4}\s+(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|BLVD|CT|CIR|HWY|TRL|TR)\b/gi, '[ADDRESS_REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
    .replace(/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
}

function isForbiddenClick(text) {
  return FORBIDDEN_CLICK.some((re) => re.test(String(text || '')))
}

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (/Dashboard\.aspx/i.test(page.url())) {
    console.log('[login] session already valid → Dashboard')
    return
  }
  const frameHandle = await page.waitForSelector('iframe:not(.mask_iframe)', { timeout: 20000 })
  const frame = await frameHandle.contentFrame()
  if (!frame) throw new Error('Login iframe missing')
  await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
  await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
  console.log('[login] Solving reCAPTCHA via 2Captcha…')
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
  console.log('[login] OK →', page.url())
}

async function waitQuiet(page) {
  await page.waitForTimeout(1500)
  await page.evaluate(function () {
    return new Promise(function (resolve) {
      var n = 0
      var t = setInterval(function () {
        n++
        var el = document.getElementById('divGlobalLoadingImg') || document.getElementById('divGlobalLoading')
        var busy = el && window.getComputedStyle(el).display !== 'none'
        if (!busy || n > 40) { clearInterval(t); resolve() }
      }, 250)
    })
  }).catch(() => null)
}

/** Find the exact requested record's CapDetail href — keep identity in tmp only. */
async function findTargetHref(page, targetRecordNumber) {
  await page.goto('https://aca-prod.accela.com/POLKCO/Cap/MyRecordsCap.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await waitQuiet(page)

  for (let pageNum = 1; pageNum <= 12; pageNum++) {
    console.log('[search] MyRecords page', pageNum)
    const found = await page.evaluate(function (requestedRecordNumber) {
      function clean(s) {
        return String(s || '').replace(/\s+/g, ' ').trim()
      }
      var rows = Array.from(document.querySelectorAll('tr'))
      for (var i = 0; i < rows.length; i++) {
        var tr = rows[i]
        var link = tr.querySelector('a[href*="CapDetail"]')
        if (!link) continue
        // Prefer direct child cells so nested pager/header blobs don't pollute
        var cells = Array.from(tr.querySelectorAll(':scope > td')).map(function (td) {
          return clean(td.innerText)
        })
        if (cells.length < 6) {
          cells = Array.from(tr.querySelectorAll('td')).map(function (td) { return clean(td.innerText) })
        }
        // Observed layout: [1]=Record Number, [2]=Type, [5]=Status
        var altId = clean(link.innerText)
        var status = cells[5] || ''
        var type = cells[2] || ''
        if (altId.toLowerCase() !== requestedRecordNumber.toLowerCase()) continue
        return {
          href: link.href,
          altId: altId,
          status: status,
          recordType: type,
          rowSnippet: cells.slice(0, 8).join(' | ').slice(0, 240),
        }
      }
      return null
    }, targetRecordNumber)
    if (found) {
      console.log('[search] matched explicitly requested record; type=', found.recordType)
      return found
    }

    const next = page.locator('a').filter({ hasText: /^\s*Next\s*>\s*$/i }).first()
    if (!(await next.count())) break
    const cls = ((await next.getAttribute('class').catch(() => '')) || '')
    if (/disabled/i.test(cls)) break
    await next.click({ force: true }).catch(() => null)
    await waitQuiet(page)
  }
  return null
}

async function inventoryCorrectionPage(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // Softer visibility for Accela detail panels that may be height-collapsed but still in DOM
    function inDom(el) {
      return !!el && el.getClientRects && el.getClientRects().length >= 0
    }
    function textOf(el) {
      return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400)
    }
    function redactLocal(s) {
      return String(s || '')
        .replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[RECORD_REDACTED]')
        .replace(/capID[123]=[^&\s"']+/gi, 'capID=[REDACTED]')
    }

    var statusCandidates = []
    document.querySelectorAll('[id*="Status"], [id*="status"], .ACA_SmLabelBolder, .ACA_StatusLabel').forEach(function (el) {
      var t = textOf(el)
      if (t && /required|complete|issued|review|info|inactive|withdrawn|denied|pending/i.test(t) && t.length < 80) {
        statusCandidates.push({ id: el.id || null, text: redactLocal(t), visible: visible(el) })
      }
    })

    var pageTitle = textOf(document.querySelector(
      '#ctl00_PlaceHolderMain_lblPermitTitle, #ctl00_PlaceHolderMain_PermitDetailList1_permitNum, h1, .ACA_PageTitle, #ctl00_PlaceHolderMain_lblPageTitle'
    ))

    // Detail section headers / values in main content
    var detailPairs = []
    document.querySelectorAll('#ctl00_PlaceHolderMain span, #ctl00_PlaceHolderMain td, #ctl00_PlaceHolderMain label, #ctl00_PlaceHolderMain th').forEach(function (el) {
      if (!visible(el) && !inDom(el)) return
      var t = textOf(el)
      if (!t || t.length < 2 || t.length > 180) return
      if (/^(HOME|APPLY|SEARCH|ACCOUNT|LOGOUT|Cart|Skip)/i.test(t)) return
      if (/status|type|module|condition|comment|correct|additional|required|document|attachment|description|project|expiration|opened|file date|record/i.test(t)) {
        detailPairs.push({ id: el.id || null, text: redactLocal(t) })
      }
    })

    var tabs = []
    document.querySelectorAll('a[data-control], a[href^="#tab-"], #lnkMoreDetail').forEach(function (el) {
      var t = textOf(el) || el.getAttribute('title') || el.getAttribute('data-control') || ''
      t = t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (!t) return
      tabs.push({
        text: redactLocal(t).slice(0, 80),
        id: el.id || null,
        dataControl: el.getAttribute('data-control') || null,
        href: (el.getAttribute('href') || '').slice(0, 80),
        visible: visible(el),
      })
    })

    var actions = []
    document.querySelectorAll('a, button, input[type="button"], input[type="submit"], .ACA_Button').forEach(function (el) {
      if (!visible(el)) return
      var t = textOf(el)
      if (!t) return
      if (/^(HOME|APPLY|SEARCH|ACCOUNT|LOGOUT|Cart|instagram|youtube|facebook|twitter|Translate)$/i.test(t)) return
      if (/Skip to|Skip Module|Global Search|AGENCY LINKS/i.test(t)) return
      var href = el.getAttribute('href') || ''
      var onclick = el.getAttribute('onclick') || ''
      var blob = t + ' ' + href + ' ' + onclick + ' ' + (el.id || '')
      var looksResponse = /respond|correction|additional\s*info|resubmit|upload|edit|resume|revise|amend/i.test(blob)
      var looksDangerous = /submit|pay|delete|cancel|schedule|checkout|save/i.test(blob)
      actions.push({
        text: redactLocal(t).slice(0, 120),
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        locator: el.id ? '#' + el.id : el.tagName.toLowerCase() + ':has-text("' + redactLocal(t).slice(0, 40).replace(/"/g, '') + '")',
        hrefRedacted: href
          ? redactLocal(href).replace(/capID[123]=[^&]+/gi, 'capID=[REDACTED]').slice(0, 160)
          : null,
        dataControl: el.getAttribute('data-control') || null,
        onclickHint: /respond|correction|edit|resume|upload|submit|save|delete/i.test(onclick)
          ? onclick.slice(0, 140)
          : null,
        looksResponseAction: looksResponse,
        looksDangerous: looksDangerous,
        clicked: false,
      })
    })

    var messageBlocks = []
    var messageSelectors = [
      '[id*="Condition"]', '[id*="condition"]', '[id*="Comment"]', '[id*="comment"]',
      '[id*="Message"]', '[id*="Correction"]', '[id*="Additional"]', '[id*="Deficiency"]',
      '[id*="Review"]', '[id*="WorkFlow"]', '[id*="Process"]',
      '.ACA_Message_Error', '.ACA_Message_Notice', '.ACA_Error', 'fieldset', 'legend',
      '#divASIList', '#divCapCondition', '#divWorkFlow',
    ]
    messageSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        var t = textOf(el)
        if (!t || t.length < 8) return
        if (!/condition|comment|correct|additional|required|deficient|review|missing|upload|document|info|deadline|due|respond|process|status/i.test(t)) return
        messageBlocks.push({
          selectorHint: el.id ? '#' + el.id : el.tagName.toLowerCase(),
          id: el.id || null,
          text: redactLocal(t).slice(0, 600),
          visible: visible(el),
        })
      })
    })

    var body = (document.body && document.body.innerText) || ''
    var keywordSnippets = []
    var re = /.{0,100}(additional\s+info|correction|condition|respond|resubmit|deficient|missing|required|due\s+date|deadline|upload|attachment).{0,140}/gi
    var m
    while ((m = re.exec(body)) && keywordSnippets.length < 30) {
      keywordSnippets.push(redactLocal(m[0].replace(/\s+/g, ' ').trim()))
    }

    var fields = []
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden') return
      if (!visible(el)) return
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        id: el.id || null,
        name: el.name || null,
        readonly: !!(el.readOnly || el.disabled),
        locator: el.id ? '#' + el.id : null,
      })
    })

    var fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(function (el) {
      return { id: el.id || null, name: el.name || null, visible: visible(el), locator: el.id ? '#' + el.id : 'input[type=file]' }
    })

    // Main content text sample (redacted) for structure understanding
    var main = document.querySelector('#ctl00_PlaceHolderMain, #divWorkArea, form')
    var mainSnippet = redactLocal(textOf(main)).slice(0, 1200)

    return {
      title: redactLocal(document.title),
      h1: redactLocal(pageTitle),
      urlRedacted: location.href
        .replace(/capID[123]=[^&]+/gi, 'capID=[REDACTED]')
        .replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[RECORD_REDACTED]'),
      statusCandidates: statusCandidates.slice(0, 20),
      detailPairs: detailPairs.slice(0, 80),
      tabs: tabs.slice(0, 40),
      actions: actions.slice(0, 80),
      messageBlocks: messageBlocks.slice(0, 40),
      keywordSnippets: keywordSnippets,
      fields: fields.slice(0, 60),
      fileInputs: fileInputs.slice(0, 20),
      mainSnippet: mainSnippet,
    }
  })
}

/** Activate Accela detail tab via JS (view-only) — avoids hidden-tab click failures */
async function activateDetailTab(page, dataControl) {
  console.log('[tab]', dataControl)
  const ok = await page.evaluate(function (dc) {
    var el = document.querySelector('a[data-control="' + dc + '"]')
    if (!el) return false
    el.click()
    return true
  }, dataControl)
  await waitQuiet(page)
  return ok
}

async function safeViewOnlyClick(page, label, locator) {
  // Only allow purely navigational view chrome that is NOT a response/edit action
  if (isForbiddenClick(label)) {
    console.log('[skip-click] forbidden:', label)
    return false
  }
  if (/respond|correction|upload|edit|resume|submit|pay|delete|save/i.test(label)) {
    console.log('[skip-click] response-like:', label)
    return false
  }
  // Allow Expand More Details / Record Info / Conditions-looking VIEW tabs only if not respond
  console.log('[view-click]', label)
  await locator.click({ force: true }).catch((e) => console.log('[view-click failed]', e.message))
  await waitQuiet(page)
  return true
}

async function main() {
  ensureOut()
  console.log('=== Correction-flow inspect (view-only) ===')
  console.log('Target: explicitly provided record number')
  console.log('Rules: NO Respond/Edit/Resume/Upload/Submit/Pay/Delete')

  const svc = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)

  const solver = new Solver(CAPTCHA_API_KEY)
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })

  const contextOpts = {
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
  for (const p of STORAGE_CANDIDATES) {
    if (fs.existsSync(p)) {
      contextOpts.storageState = p
      console.log('[session] using', p)
      break
    }
  }

  const context = await browser.newContext(contextOpts)
  const page = await context.newPage()
  page.setDefaultTimeout(45000)

  const safety = {
    clickedRespond: false,
    clickedEdit: false,
    clickedUpload: false,
    clickedSubmit: false,
    typedAnything: false,
  }

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: path.join(OUT_DIR, 'storageState-polk-gator.json') })

    const target = await findTargetHref(page, TARGET_RECORD_NUMBER)
    if (!target) throw new Error('Could not find the explicitly requested record on MyRecords')

    // Persist raw identity only in gitignored tmp
    fs.writeFileSync(
      path.join(OUT_DIR, 'target-raw.json'),
      JSON.stringify(
        {
          foundAt: new Date().toISOString(),
          altId: target.altId,
          status: target.status,
          recordType: target.recordType,
          href: target.href,
          rowSnippet: target.rowSnippet,
          note: 'RAW — do not commit. Identity came from explicit AHJ_DISCOVERY_RECORD_NUMBER input.',
        },
        null,
        2
      )
    )
    console.log('[nav] CapDetail (view-only) — identity written to tmp only')

    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitQuiet(page)
    // Prefer Expand More Details first so secondary tabs become available
    await page.evaluate(function () {
      var el = document.getElementById('lnkMoreDetail')
      if (el) el.click()
    }).catch(() => null)
    await waitQuiet(page)
    await page.screenshot({ path: path.join(OUT_DIR, '01-capdetail.png'), fullPage: true }).catch(() => null)

    const pages = []
    const base = await inventoryCorrectionPage(page)
    pages.push({ label: 'capdetail_initial', ...base })

    // View-only detail tabs via data-control (no Respond/Edit/Upload)
    for (const dc of [
      'tab-related_records',
      'tab-processing_status',
      'tab-attachments',
      'tab-record_info',
      'tab-conditions',
      'tab-asi',
    ]) {
      const activated = await activateDetailTab(page, dc)
      if (!activated) {
        console.log('[tab] not present:', dc)
        continue
      }
      const slug = dc.replace(/^tab-/, '')
      await page.screenshot({ path: path.join(OUT_DIR, 'tab-' + slug + '.png'), fullPage: true }).catch(() => null)
      pages.push({ label: slug, ...(await inventoryCorrectionPage(page)) })
    }

    // Build redacted summary for chat / NOTES
    const allActions = []
    const seenAct = new Set()
    const allMessages = []
    const allSnippets = []
    const allDetails = []
    const allTabs = []
    const responseActions = []
    const statusCandidates = []

    for (const p of pages) {
      for (const a of p.actions || []) {
        const key = a.id + '|' + a.text
        if (seenAct.has(key)) continue
        seenAct.add(key)
        const action = {
          ...a,
          text: redact(a.text),
          hrefRedacted: a.hrefRedacted ? redact(a.hrefRedacted) : null,
        }
        allActions.push(action)
        if (
          action.looksResponseAction ||
          isForbiddenClick(action.text) ||
          /respond|upload|edit|resume|correction/i.test(action.text)
        ) {
          // Exclude cart/pay false positives from "response mechanism" primary list
          if (/add to cart|payments|checkout/i.test(action.text) && !/respond|correction|upload|edit/i.test(action.text)) {
            continue
          }
          responseActions.push({
            text: action.text,
            id: action.id,
            locator: action.locator,
            dataControl: action.dataControl || null,
            hrefRedacted: action.hrefRedacted,
            onclickHint: action.onclickHint,
            note: 'LOCATED ONLY — not clicked',
          })
        }
      }
      for (const m of p.messageBlocks || []) {
        allMessages.push({ ...m, text: redact(m.text) })
      }
      for (const s of p.keywordSnippets || []) {
        allSnippets.push(redact(s))
      }
      for (const d of p.detailPairs || []) {
        allDetails.push({ ...d, text: redact(d.text) })
      }
      for (const t of p.tabs || []) {
        allTabs.push(t)
      }
      for (const sc of p.statusCandidates || []) {
        statusCandidates.push(sc)
      }
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      scopeWarning:
        'Accela detail patterns from one explicitly selected record. Treat findings as specific to the reported record type and status.',
      recordFamily: {
        prefix: String(target.altId || '').split('-')[0] || null,
        typeCategory: target.recordType || null,
        status: target.status || null,
      },
      safety,
      pagesVisited: pages.map((p) => ({
        label: p.label,
        urlRedacted: redact(p.urlRedacted || ''),
        h1: redact(p.h1 || ''),
        statusCandidates: (p.statusCandidates || []).slice(0, 5),
        tabCount: (p.tabs || []).length,
        actionCount: (p.actions || []).length,
        fieldCount: (p.fields || []).length,
        fileInputCount: (p.fileInputs || []).length,
        messageBlockCount: (p.messageBlocks || []).length,
        mainSnippet: redact(p.mainSnippet || '').slice(0, 400),
      })),
      statusCandidates: statusCandidates.slice(0, 15),
      detailTabsPresent: [...new Map(allTabs.map((t) => [t.dataControl || t.text, t])).values()].slice(0, 30),
      responseMechanism: {
        found: responseActions.length > 0,
        actionsLocatedNotClicked: responseActions.slice(0, 30),
        note: 'No Respond/Edit/Upload was activated. Cart/Payments excluded from this list.',
      },
      correctionCommunication: {
        messageBlocks: allMessages.slice(0, 40),
        keywordSnippets: [...new Set(allSnippets)].slice(0, 30),
        detailPairsSample: allDetails.slice(0, 40),
      },
      structuralSelectors: {
        note: 'Provisional Accela patterns from the explicitly selected record type and status.',
        actions: allActions
          .filter((a) =>
            a.looksResponseAction ||
            /condition|attachment|document|record info|more detail|process|related|respond|upload/i.test(a.text)
          )
          .slice(0, 40),
        fileInputsSeen: pages.flatMap((p) => p.fileInputs || []).slice(0, 15),
      },
    }

    // Absolute no permit/address leak in summary
    const summaryJson = JSON.stringify(summary, null, 2)
    if (/\b[A-Z]{1,4}-\d{4}-\d+\b/i.test(summaryJson)) {
      throw new Error('Summary still contains record numbers — abort write')
    }

    fs.writeFileSync(path.join(OUT_DIR, 'correction-summary.json'), summaryJson)
    fs.writeFileSync(
      path.join(OUT_DIR, 'correction-raw-pages.json'),
      JSON.stringify(
        {
          note: 'RAW page inventories — may contain PII; gitignored',
          targetAltId: target.altId,
          pages,
        },
        null,
        2
      )
    )

    console.log('[done] summary →', path.join(OUT_DIR, 'correction-summary.json'))
    console.log('[done] response actions found:', summary.responseMechanism.found, 'count=', responseActions.length)
    console.log('[done] message blocks:', allMessages.length, 'snippets:', allSnippets.length)
    console.log('[done] safety:', JSON.stringify(safety))
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  console.error(e.stack)
  process.exit(1)
})
