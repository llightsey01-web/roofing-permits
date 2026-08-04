/**
 * Batch A — Polk Accela read-only portal discovery (Gator Roof Systems).
 * NEVER submit, pay, delete, cancel, schedule, attest/accept certifications, or email.
 * Does NOT check disclaimer agreement or continue into a new application.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   TWOCAPTCHA_API_KEY=... node scripts/diagnostics/ahj-discovery/polk-batch-a-discovery.js
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
const CAPTCHA_API_KEY = requiredEnv('TWOCAPTCHA_API_KEY')
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a')
const STORAGE_PATH = path.join(OUT_DIR, 'storageState-polk-gator.json')

const BLOCK_LABELS = [
  /submit/i,
  /pay(\s|$|ment)/i,
  /checkout/i,
  /delete/i,
  /cancel\s+(permit|application|record)/i,
  /schedule\s+inspection/i,
  /send\s+(email|notification|text)/i,
  /i\s+(agree|accept|certify|attest)/i,
  /continue\s+application/i,
]

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function isDangerousLabel(text) {
  const t = String(text || '').trim()
  if (!t) return false
  return BLOCK_LABELS.some((re) => re.test(t))
}

async function inventoryPage(page, label) {
  const info = await page.evaluate(() => {
    function visible(el) {
      if (!el) return false
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    function textOf(el) {
      return (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    }
    /** Accela record-detail / result-grid row — never capture href/text contents */
    function isRecordDetailOrGridRow(el, href, text) {
      const h = String(href || '')
      const t = String(text || '')
      if (/CapDetail\.aspx/i.test(h)) return true
      if (/capID1=|capID2=|capID3=/i.test(h)) return true
      if (/\/Cap\/CapDetail/i.test(h)) return true
      // Permit / record number patterns (Polk BT-YYYY-N, generic agency IDs)
      if (/^[A-Z]{1,4}-\d{4}-\d+$/i.test(t.trim())) return true
      if (/^[A-Z]{2,}\d{2}-\d+$/i.test(t.trim())) return true
      // Inside Accela permit/result grids
      if (el && el.closest) {
        const grid = el.closest(
          'table[id*="gdvPermitList"], [id$="gdvPermitList"], table.ACA_GridView, .ACA_Grid_OverFlow'
        )
        if (grid && (el.tagName === 'A' || el.closest('td'))) return true
      }
      return false
    }
    function locatorHint(el) {
      if (el.id) return '#' + el.id
      if (el.name) return '[name="' + el.name + '"]'
      const testid = el.getAttribute('data-testid')
      if (testid) return '[data-testid="' + testid + '"]'
      // Never embed record-detail hrefs into locator hints
      if (el.tagName === 'A' && el.getAttribute('href')) {
        const href = el.getAttribute('href') || ''
        if (isRecordDetailOrGridRow(el, href, textOf(el))) {
          return el.id ? '#' + el.id : 'a[record-detail-redacted]'
        }
        if (href && href !== '#' && !href.startsWith('javascript:')) {
          return 'a[href="' + href.slice(0, 80) + '"]'
        }
      }
      const t = textOf(el)
      if (t && t.length < 60 && !isRecordDetailOrGridRow(el, '', t)) {
        return el.tagName.toLowerCase() + ':has-text("' + t.replace(/"/g, '\\"') + '")'
      }
      return el.tagName.toLowerCase()
    }

    const breadcrumb = Array.from(document.querySelectorAll('.ACA_Title_Bar, .ACA_SmLabel, .breadcrumb, nav[aria-label*="breadcrumb" i] li, #ctl00_PlaceHolderMain_lblPageTitle'))
      .map(textOf)
      .filter(Boolean)
      // Keep aggregate chrome only — drop tokens that look like permit IDs
      .filter(function (t) { return !/^[A-Z]{1,4}-\d{4}-\d+$/i.test(t.trim()) })
      .slice(0, 12)

    const links = []
    let recordDetailLinksSkipped = 0
    document.querySelectorAll('a[href]').forEach((el) => {
      if (!visible(el)) return
      const href = el.getAttribute('href') || ''
      if (href.startsWith('javascript:') && href.length < 20) return
      const text = textOf(el)
      if (isRecordDetailOrGridRow(el, href, text)) {
        recordDetailLinksSkipped++
        return
      }
      links.push({
        text: text,
        href: href.slice(0, 200),
        locator: locatorHint(el),
      })
    })

    const buttons = []
    document.querySelectorAll('button, input[type="submit"], input[type="button"], a.ACA_Button, .ACA_Button').forEach((el) => {
      if (!visible(el)) return
      const text = textOf(el) || el.value || ''
      // Skip buttons whose visible label is a permit number (unlikely but safe)
      if (/^[A-Z]{1,4}-\d{4}-\d+$/i.test(text.trim())) return
      buttons.push({
        text: text,
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        locator: locatorHint(el),
        id: el.id || null,
      })
    })

    const inputs = []
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!visible(el)) return
      if (el.type === 'hidden') return
      // Skip per-row grid controls entirely — only non-grid form fields are inventoried
      const inGrid = !!(el.closest && el.closest('table[id*="gdvPermitList"], [id$="gdvPermitList"]'))
      if (inGrid) return
      inputs.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        label: (() => {
          if (el.id) {
            const lab = document.querySelector('label[for="' + el.id + '"]')
            if (lab) return textOf(lab)
          }
          return el.getAttribute('aria-label') || el.placeholder || null
        })(),
        locator: locatorHint(el),
      })
    })

    // Structural note only — that result grids exist, not their contents / row controls
    const grids = []
    document.querySelectorAll('table[id*="gdvPermitList"], [id$="gdvPermitList"]').forEach((g) => {
      if (!g.id) return
      if (grids.some(function (x) { return x.id === g.id })) return
      const rowCheckboxes = g.querySelectorAll('input[type="checkbox"]')
      grids.push({
        id: g.id,
        locator: '#' + g.id,
        tag: g.tagName.toLowerCase(),
        checkboxCountVisible: Array.from(rowCheckboxes).filter(visible).length,
        note: 'Result/record grid present — row contents intentionally not captured',
      })
    })

    const frames = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      id: f.id || null,
      name: f.name || null,
      src: (f.src || '').slice(0, 200),
      title: f.title || null,
    }))

    // Chrome-only snippet: strip permit-number tokens if any leak into visible text
    let bodySnippet = (document.body && document.body.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
    bodySnippet = bodySnippet.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]')

    return {
      title: document.title,
      url: location.href,
      h1: textOf(document.querySelector('h1, .ACA_PageTitle, #ctl00_PlaceHolderMain_lblPageTitle')),
      breadcrumb,
      linkCount: links.length,
      recordDetailLinksSkipped: recordDetailLinksSkipped,
      links: links.slice(0, 80),
      buttons: buttons.slice(0, 60),
      inputs: inputs.slice(0, 80),
      resultGrids: grids,
      frames,
      bodySnippet: bodySnippet,
    }
  })

  info.label = label
  info.dangerousButtons = (info.buttons || []).filter((b) => isDangerousLabel(b.text))
  info.safeNavLinks = (info.links || []).filter((l) => {
    if (!l.text && !l.href) return false
    if (isDangerousLabel(l.text)) return false
    const href = (l.href || '').toLowerCase()
    if (/pay|payment|checkout|delete|cancel|submit/.test(href)) return false
    // Defense in depth — never keep CapDetail / capID links even if evaluate missed one
    if (/capdetail\.aspx|capid1=|capid2=|capid3=/i.test(href)) return false
    if (/^[A-Z]{1,4}-\d{4}-\d+$/i.test(String(l.text || '').trim())) return false
    return true
  }).slice(0, 40)

  const shot = path.join(OUT_DIR, label.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.png')
  await page.screenshot({ path: shot, fullPage: true }).catch(() => null)
  info.screenshot = shot
  return info
}

async function login(page, credentials, solver) {
  await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)

  // Already logged in?
  if (/Dashboard\.aspx/i.test(page.url())) {
    console.log('[login] Already on dashboard')
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

  await page.waitForURL('**/Dashboard.aspx**', { timeout: 45000 })
  await page.waitForTimeout(2000)
  console.log('[login] OK →', page.url())
}

async function safeGoto(page, url, label) {
  console.log('[nav]', label, '→', url)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2000)
  // Hard stop if we landed on payment/submit-looking URL
  const u = page.url().toLowerCase()
  if (/payment|checkout|pay\.aspx|feeestimate.*pay/i.test(u)) {
    console.log('[STOP] Payment-related URL reached — documenting and backing out without acting')
  }
  return inventoryPage(page, label)
}

async function main() {
  ensureOut()

  console.log('=== STEP 0 reminder ===')
  console.log('Config:', 'automation/ahjs/configs/polk-county.config.js')
  console.log('Session file (gitignored):', STORAGE_PATH)
  console.log('Company:', COMPANY_ID)
  console.log('AHJ:', AHJ_ID)
  console.log('Rules: NO submit/pay/delete/cancel/schedule/attest/email')

  const svc = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)

  const solver = new Solver(CAPTCHA_API_KEY)
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(45000)

  const pages = []
  const notes = []

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: STORAGE_PATH })
    console.log('[session] wrote gitignored storageState')

    pages.push(await inventoryPage(page, '01_dashboard'))

    // Collect likely module/home URLs from dashboard
    const dashLinks = pages[0].safeNavLinks || []
    const interesting = []
    const seen = new Set()
    for (const l of dashLinks) {
      const href = l.href || ''
      if (!href || href === '#' || href.startsWith('javascript:')) continue
      let abs = href
      try {
        abs = new URL(href, page.url()).href
      } catch (e) {
        continue
      }
      if (!/aca-prod\.accela\.com\/POLKCO/i.test(abs)) continue
      // Never follow record-detail / permit-row links
      if (/CapDetail\.aspx|capID1=|capID2=|capID3=/i.test(abs)) continue
      if (/^[A-Z]{1,4}-\d{4}-\d+$/i.test(String(l.text || '').trim())) continue
      if (seen.has(abs)) continue
      const key = (l.text + ' ' + abs).toLowerCase()
      if (/home|dashboard|work|permit|record|search|building|document|upload|application|create|apply|cap\//i.test(key)) {
        seen.add(abs)
        interesting.push({ text: l.text, href: abs })
      }
    }

    // Known Accela entry points from config (read-only reach)
    const known = [
      { label: '02_disclaimer_page_read_only', url: config.selectors.disclaimerUrl, note: 'Reached CapApplyDisclaimer only — DID NOT check agreement or Continue Application' },
      { label: '03_building_module_home', url: 'https://aca-prod.accela.com/POLKCO/Dashboard.aspx?module=Building' },
      { label: '04_cap_home_building', url: 'https://aca-prod.accela.com/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building' },
      { label: '05_cap_search', url: 'https://aca-prod.accela.com/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building&TabList=HOME%7C0%7CBuilding%7C1%7CTabName%7CBuilding' },
    ]

    for (const k of known) {
      try {
        const inv = await safeGoto(page, k.url, k.label)
        if (k.note) {
          inv.safetyNote = k.note
          notes.push(k.note)
        }
        // Explicitly do NOT click Continue Application / accept checkbox
        if (/CapApplyDisclaimer/i.test(page.url())) {
          inv.attestationGate = {
            checkboxSelector: config.selectors.disclaimerCheckbox,
            continueSelector: 'text=Continue Application',
            actionTaken: 'NONE — attestation not accepted (Batch A rule)',
          }
        }
        pages.push(inv)
      } catch (err) {
        pages.push({ label: k.label, error: err.message, url: k.url })
        notes.push('Failed to open ' + k.label + ': ' + err.message)
      }
    }

    // Follow a few safe dashboard links (max 6), skip dangerous labels
    let followed = 0
    for (const item of interesting) {
      if (followed >= 6) break
      if (isDangerousLabel(item.text)) {
        notes.push('Skipped dangerous-looking link: ' + item.text)
        continue
      }
      if (/disclaimer|CapApply|ApplyDisclaimer|payment|pay\.|FeeEstimate/i.test(item.href) && !/CapApplyDisclaimer/i.test(item.href)) {
        // CapApplyDisclaimer already covered; skip other apply deep-links that might auto-start
        if (/CapType|CapEdit|Fee|Payment/i.test(item.href)) {
          notes.push('Skipped apply/payment deep link: ' + item.text + ' → ' + item.href)
          continue
        }
      }
      try {
        const inv = await safeGoto(page, item.href, 'nav_' + String(++followed).padStart(2, '0') + '_' + (item.text || 'link').slice(0, 40))
        inv.fromLinkText = item.text
        pages.push(inv)
      } catch (err) {
        notes.push('Nav failed for ' + item.text + ': ' + err.message)
      }
    }

    // Return to dashboard end state
    await safeGoto(page, 'https://aca-prod.accela.com/POLKCO/Dashboard.aspx', '99_dashboard_end')

    const report = {
      generatedAt: new Date().toISOString(),
      companyId: COMPANY_ID,
      ahjId: AHJ_ID,
      portalBase: 'https://aca-prod.accela.com/POLKCO/',
      configPath: 'automation/ahjs/configs/polk-county.config.js',
      safety: {
        submitted: false,
        paid: false,
        deleted: false,
        cancelled: false,
        scheduledInspection: false,
        acceptedAttestation: false,
        emailed: false,
        modifiedAccountSettings: false,
      },
      notes,
      pages,
    }

    const outJson = path.join(OUT_DIR, 'batch-a-portal-map.json')
    fs.writeFileSync(outJson, JSON.stringify(report, null, 2))
    console.log('[done] wrote', outJson)
    console.log('[done] pages captured:', pages.length)
    console.log('[done] attestation accepted: NO')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
