/**
 * Batch B — Polk Accela Phases 3–6 (read-only).
 * Phase 3: conditional logic · Phase 4: form field intelligence
 * Phase 5: network observation · Phase 6: document requirements
 * Plus: locate draft discard/delete controls (do NOT use them).
 *
 * NEVER submit / pay / delete / cancel / schedule / attest / email / change settings.
 * NEVER capture CapDetail hrefs, permit numbers, or grid row contents into the report.
 * CapApplyDisclaimer is viewed only — attestation not accepted.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   TWOCAPTCHA_API_KEY=... node scripts/diagnostics/ahj-discovery/polk-batch-b-discovery.js
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
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-b')
const STORAGE_PATH = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a', 'storageState-polk-gator.json')
const STORAGE_B = path.join(OUT_DIR, 'storageState-polk-gator.json')

const DANGEROUS = [
  /submit/i,
  /pay(\s|$|ment)/i,
  /checkout/i,
  /\bdelete\b/i,
  /cancel\s+(permit|application|record)/i,
  /schedule\s+inspection/i,
  /send\s+(email|notification|text)/i,
  /i\s+(agree|accept|certify|attest)/i,
  /continue\s+application/i,
]

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function redact(s) {
  return String(s || '')
    .replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]')
    .replace(/capID[123]=[^&\s"']+/gi, 'capID$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
}

function isDangerous(text) {
  return DANGEROUS.some((re) => re.test(String(text || '')))
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

async function waitQuiet(page, ms) {
  await page.waitForTimeout(ms || 1200)
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

/** Phase 4 helper — option lists for visible selects (no values from grids) */
async function captureSelectOptions(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    function labelFor(el) {
      if (el.id) {
        var lab = document.querySelector('label[for="' + el.id + '"]')
        if (lab) return (lab.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      }
      return el.getAttribute('aria-label') || el.name || el.id || null
    }
    var out = []
    document.querySelectorAll('select').forEach(function (sel) {
      if (!visible(sel)) return
      // Skip selects nested in result grids
      if (sel.closest && sel.closest('table[id*="gdvPermitList"], [id$="gdvPermitList"]')) return
      var opts = Array.from(sel.options).map(function (o) {
        return { value: String(o.value || '').slice(0, 80), text: (o.text || '').replace(/\s+/g, ' ').trim().slice(0, 120) }
      })
      out.push({
        id: sel.id || null,
        name: sel.name || null,
        label: labelFor(sel),
        locator: sel.id ? '#' + sel.id : '[name="' + sel.name + '"]',
        optionCount: opts.length,
        options: opts.slice(0, 80),
      })
    })
    return out
  })
}

/** Visible action chrome — buttons/links that look like discard/delete/resume (labels only) */
async function scanDraftCleanupControls(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    function textOf(el) {
      return (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 100)
    }
    var patterns = /discard|delete|remove|abandon|withdraw|void|cancel\s+application|save\s+and\s+resume|resume\s+application|incomplete/i
    var hits = []
    document.querySelectorAll('a, button, input[type="button"], input[type="submit"], .ACA_Button').forEach(function (el) {
      if (!visible(el)) return
      var t = textOf(el)
      var href = el.getAttribute && el.getAttribute('href') || ''
      var onclick = el.getAttribute && el.getAttribute('onclick') || ''
      var blob = t + ' ' + href + ' ' + onclick
      if (!patterns.test(blob)) return
      // Never capture CapDetail / permit-row links as cleanup evidence of record identity
      if (/CapDetail\.aspx|capID1=|capID2=|capID3=/i.test(href)) {
        hits.push({
          kind: 'record-detail-action-link-redacted',
          text: t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'),
          id: el.id || null,
          locator: el.id ? '#' + el.id : 'a[record-detail-redacted]',
          href: '[CapDetail-redacted]',
          note: 'CapDetail href present but not captured',
        })
        return
      }
      hits.push({
        kind: 'control',
        text: t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'),
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        locator: el.id ? '#' + el.id : el.tagName.toLowerCase(),
        href: href && !href.startsWith('javascript:') ? href.slice(0, 160) : null,
        onclickHint: /delete|discard|abandon|remove|doSaveAndResume|resume/i.test(onclick)
          ? onclick.slice(0, 120)
          : null,
      })
    })
    // Page-level copy mentioning discard/delete draft
    var body = (document.body && document.body.innerText || '').replace(/\s+/g, ' ')
    var draftMentions = []
    body.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]')
    var snippets = body.match(/.{0,40}(discard|delete\s+(draft|application|record)|save\s+and\s+resume|resume\s+application|incomplete).{0,40}/gi) || []
    snippets.slice(0, 15).forEach(function (s) {
      draftMentions.push(s.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]').trim())
    })
    return { controls: hits.slice(0, 40), draftMentions: draftMentions }
  })
}

/** Document-requirement signals on current page (labels/text only) */
async function scanDocumentRequirements(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    var docPatterns = /document|attachment|upload|NOC|notice\s+of\s+commencement|product\s+approval|affidavit|insurance|certificate|plan|drawing|roof/i
    var hits = []
    document.querySelectorAll('a, button, label, th, .ACA_Page_Header, .ACA_Title_Bar, h1, h2, h3, legend').forEach(function (el) {
      if (!visible(el)) return
      var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)
      if (!t || !docPatterns.test(t)) return
      if (/CapDetail\.aspx|capID/i.test(el.getAttribute && el.getAttribute('href') || '')) return
      hits.push({
        tag: el.tagName.toLowerCase(),
        text: t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'),
        id: el.id || null,
      })
    })
    // File inputs = upload surface present
    var fileInputs = []
    document.querySelectorAll('input[type="file"]').forEach(function (el) {
      if (!visible(el)) return
      fileInputs.push({ id: el.id || null, name: el.name || null, locator: el.id ? '#' + el.id : 'input[type=file]' })
    })
    return { documentChrome: hits.slice(0, 50), fileInputs: fileInputs }
  })
}

async function snapshotFormState(page) {
  return page.evaluate(function () {
    function visible(el) {
      if (!el) return false
      var s = window.getComputedStyle(el)
      if (s.display === 'none' || s.visibility === 'hidden') return false
      var r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    var fields = []
    document.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden') return
      if (!visible(el)) return
      if (el.closest && el.closest('table[id*="gdvPermitList"], [id$="gdvPermitList"]')) return
      fields.push({
        id: el.id || null,
        name: el.name || null,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
      })
    })
    return {
      url: location.href,
      title: document.title,
      fieldIds: fields.map(function (f) { return f.id || f.name }).filter(Boolean).sort(),
      fieldCount: fields.length,
    }
  })
}

async function main() {
  ensureOut()
  console.log('=== Batch B Phases 3–6 ===')
  console.log('Rules: NO submit/pay/delete/cancel/schedule/attest/email')
  console.log('Attestation: will NOT accept CapApplyDisclaimer')

  const svc = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await svc.getCredentials(COMPANY_ID, AHJ_ID)
  console.log('[creds] source=', credentials.source, 'provider=', credentials.provider)

  const networkLog = []
  const conditionalFindings = []
  const formIntel = []
  const docFindings = []
  const draftCleanup = { pages: [], verdict: null, evidence: [] }
  const notes = []
  const safety = {
    submitted: false,
    paid: false,
    deleted: false,
    cancelled: false,
    scheduledInspection: false,
    acceptedAttestation: false,
    emailed: false,
    modifiedAccountSettings: false,
    clickedDangerousControl: false,
  }

  const solver = new Solver(CAPTCHA_API_KEY)
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  })

  const contextOpts = {
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
  if (fs.existsSync(STORAGE_PATH)) {
    contextOpts.storageState = STORAGE_PATH
    console.log('[session] trying Batch A storageState')
  }
  const context = await browser.newContext(contextOpts)
  const page = await context.newPage()
  page.setDefaultTimeout(45000)

  // Phase 5 — network observation (metadata only; strip query values that look like cap IDs)
  page.on('request', (req) => {
    try {
      const url = req.url()
      if (!/aca-prod\.accela\.com\/POLKCO/i.test(url)) return
      if (!/\.(aspx|ashx|asmx)|Partial|Ajax|WebResource|ScriptResource/i.test(url) && req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') {
        if (!/Cap\/|Account\/|ShoppingCart|Attachment|Document/i.test(url)) return
      }
      let safeUrl = url
        .replace(/capID[123]=[^&]+/gi, 'capID$&=[REDACTED]')
        .replace(/([?&](?:id|capid|recordid)=)[^&]+/gi, '$1[REDACTED]')
      if (safeUrl.length > 220) safeUrl = safeUrl.slice(0, 220) + '…'
      networkLog.push({
        t: new Date().toISOString(),
        method: req.method(),
        type: req.resourceType(),
        url: safeUrl,
      })
    } catch (e) {}
  })

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: STORAGE_B })
    console.log('[session] wrote', STORAGE_B)

    // ── CapHome search form intelligence (Phase 3 + 4) ──
    console.log('[nav] CapHome search')
    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page, 2000)

    const capHomeSelectsBefore = await captureSelectOptions(page)
    formIntel.push({ page: 'CapHome', phase: 'baseline_selects', selects: capHomeSelectsBefore })
    draftCleanup.pages.push({ page: 'CapHome', ...(await scanDraftCleanupControls(page)) })
    docFindings.push({ page: 'CapHome', ...(await scanDocumentRequirements(page)) })

    const baseline = await snapshotFormState(page)

    // Phase 3: toggle "Search my records only" if present
    const chk = page.locator('#ctl00_PlaceHolderMain_chkSearch')
    if (await chk.count()) {
      const wasChecked = await chk.isChecked().catch(() => false)
      console.log('[phase3] toggle Search my records only (wasChecked=', wasChecked, ')')
      await chk.click({ force: true }).catch(() => null)
      await waitQuiet(page, 1500)
      const afterToggle = await snapshotFormState(page)
      conditionalFindings.push({
        trigger: '#ctl00_PlaceHolderMain_chkSearch toggle',
        beforeFieldCount: baseline.fieldCount,
        afterFieldCount: afterToggle.fieldCount,
        fieldsAdded: afterToggle.fieldIds.filter((id) => !baseline.fieldIds.includes(id)).slice(0, 40),
        fieldsRemoved: baseline.fieldIds.filter((id) => !afterToggle.fieldIds.includes(id)).slice(0, 40),
      })
      // restore
      if (wasChecked !== (await chk.isChecked().catch(() => false))) {
        await chk.click({ force: true }).catch(() => null)
        await waitQuiet(page, 1000)
      }
    } else {
      notes.push('Search-my-records checkbox not found on CapHome')
    }

    // Phase 3/4: cycle Search Type dropdown options (no Search click that dumps rows into our report —
    // changing ddl alone is enough to see conditional fields)
    const searchType = page.locator('#ctl00_PlaceHolderMain_ddlSearchType')
    if (await searchType.count()) {
      const options = await searchType.locator('option').evaluateAll((opts) =>
        opts.map((o) => ({ value: o.value, text: (o.text || '').trim() })).filter((o) => o.value || o.text)
      )
      formIntel.push({ page: 'CapHome', control: '#ctl00_PlaceHolderMain_ddlSearchType', options })
      const states = []
      for (const opt of options.slice(0, 8)) {
        console.log('[phase3] search type →', opt.text)
        await searchType.selectOption({ value: opt.value }).catch(async () => {
          await searchType.selectOption({ label: opt.text }).catch(() => null)
        })
        await waitQuiet(page, 1500)
        const st = await snapshotFormState(page)
        const selects = await captureSelectOptions(page)
        states.push({
          searchType: opt.text,
          fieldCount: st.fieldCount,
          fieldIds: st.fieldIds.slice(0, 60),
          selectIds: selects.map((s) => s.id || s.name),
        })
      }
      conditionalFindings.push({ trigger: 'ddlSearchType cycle', states })
    }

    // Permit type dropdown options (form intel) — do not click Search
    const permitType = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType')
    if (await permitType.count()) {
      const opts = await permitType.locator('option').evaluateAll((els) =>
        els.map((o) => ({ value: o.value, text: (o.text || '').trim() }))
      )
      formIntel.push({
        page: 'CapHome',
        control: '#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType',
        options: opts,
        reroofMatches: opts.filter((o) => /re-?roof|roof/i.test(o.text)),
      })
      console.log('[phase4] permit type options:', opts.length, 'roof-related:', opts.filter((o) => /roof/i.test(o.text)).length)
    }

    // License type dropdown
    const licType = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_ddlGSLicenseType')
    if (await licType.count()) {
      const opts = await licType.locator('option').evaluateAll((els) =>
        els.map((o) => ({ value: o.value, text: (o.text || '').trim() }))
      )
      formIntel.push({ page: 'CapHome', control: '#ctl00_PlaceHolderMain_generalSearchForm_ddlGSLicenseType', options: opts })
    }

    await page.screenshot({ path: path.join(OUT_DIR, 'cap-home-form.png'), fullPage: true }).catch(() => null)

    // ── Disclaimer page (read-only) — confirm gate still present ──
    console.log('[nav] CapApplyDisclaimer (read-only, no accept)')
    await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitQuiet(page, 1500)
    const disclaimerState = await page.evaluate(function () {
      var cb = document.querySelector('#ctl00_PlaceHolderMain_termAccept, input[type="checkbox"]')
      var cont = Array.from(document.querySelectorAll('a, button, input')).find(function (el) {
        return /continue\s+application/i.test((el.innerText || el.value || '').replace(/\s+/g, ' '))
      })
      return {
        checkboxPresent: !!cb,
        checkboxChecked: !!(cb && cb.checked),
        continuePresent: !!cont,
        continueId: cont && cont.id || null,
      }
    })
    notes.push('Disclaimer gate observed; checkboxChecked=' + disclaimerState.checkboxChecked + ' (must stay false)')
    if (disclaimerState.checkboxChecked) {
      notes.push('WARNING: disclaimer was already checked — leaving without clicking Continue')
    }
    formIntel.push({ page: 'CapApplyDisclaimer', disclaimerState })
    draftCleanup.pages.push({ page: 'CapApplyDisclaimer', ...(await scanDraftCleanupControls(page)) })

    // ── MyRecords — chrome + discard scan (no row capture) ──
    console.log('[nav] MyRecordsCap')
    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/MyRecordsCap.aspx', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page, 2000)
    const myRecSelects = await captureSelectOptions(page)
    formIntel.push({ page: 'MyRecordsCap', selects: myRecSelects })
    const myRecDraft = await scanDraftCleanupControls(page)
    draftCleanup.pages.push({ page: 'MyRecordsCap', ...myRecDraft })
    docFindings.push({ page: 'MyRecordsCap', ...(await scanDocumentRequirements(page)) })

    // Grid toolbar buttons only (structural)
    const toolbar = await page.evaluate(function () {
      function visible(el) {
        if (!el) return false
        var s = window.getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden') return false
        var r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      var btns = []
      document.querySelectorAll('a, input[type="button"], input[type="submit"], button').forEach(function (el) {
        if (!visible(el)) return
        var id = el.id || ''
        if (!/gdvPermitList|PermitList|CapList|Export|Collection|Cart|Delete|Remove|Discard/i.test(id + (el.className || ''))) return
        // Prefer toolbar / header controls, skip per-row CB_
        if (/_CB_\d+|ctl\d+_lnk/i.test(id)) return
        var t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80)
        if (!t && !id) return
        btns.push({ id: id || null, text: t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]') })
      })
      return btns.slice(0, 40)
    })
    formIntel.push({ page: 'MyRecordsCap', toolbarControls: toolbar })
    await page.screenshot({ path: path.join(OUT_DIR, 'my-records.png'), fullPage: true }).catch(() => null)

    // ── Open ONE CapDetail via first grid link (view-only) for draft/doc/action inventory ──
    // Capture action labels only; never persist permit number or full CapDetail URL.
    console.log('[nav] CapDetail sample (view-only actions; identity redacted)')
    const detailNav = await page.evaluate(function () {
      var a = document.querySelector('table[id*="gdvPermitList"] a[href*="CapDetail"], a[href*="CapDetail.aspx"]')
      if (!a) return null
      return { href: a.href, text: (a.innerText || '').trim() }
    })
    if (detailNav && detailNav.href) {
      notes.push('Opened one CapDetail for action/document discovery; permit identity redacted in report')
      await page.goto(detailNav.href, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await waitQuiet(page, 2500)
      const detailDraft = await scanDraftCleanupControls(page)
      const detailDocs = await scanDocumentRequirements(page)
      const detailActions = await page.evaluate(function () {
        function visible(el) {
          if (!el) return false
          var s = window.getComputedStyle(el)
          if (s.display === 'none' || s.visibility === 'hidden') return false
          var r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        function textOf(el) {
          return (el.innerText || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100)
        }
        var actions = []
        document.querySelectorAll('a, button, input[type="button"], input[type="submit"], .ACA_Button').forEach(function (el) {
          if (!visible(el)) return
          var t = textOf(el)
          if (!t) return
          // Skip nav chrome noise
          if (/^(HOME|APPLY|SEARCH|ACCOUNT|LOGOUT|Cart)/i.test(t)) return
          actions.push({
            text: t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'),
            id: el.id || null,
            dangerousLooking: /submit|pay|delete|cancel|schedule|email|attest|agree/i.test(t),
          })
        })
        // Section tabs
        var tabs = []
        document.querySelectorAll('.ACA_TabRow a, .tab a, #ctl00_PlaceHolderMain_tab a, [id*="tab"] a').forEach(function (el) {
          if (!visible(el)) return
          var t = textOf(el)
          if (t) tabs.push(t.replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'))
        })
        return {
          urlRedacted: location.href.replace(/capID[123]=[^&]+/gi, 'capID=[REDACTED]').replace(/\b[A-Z]{1,4}-\d{4}-\d+\b/gi, '[PERMIT_REDACTED]'),
          actions: actions.slice(0, 60),
          tabs: tabs.slice(0, 30),
        }
      })
      draftCleanup.pages.push({ page: 'CapDetail_sample', ...detailDraft })
      docFindings.push({ page: 'CapDetail_sample', ...detailDocs, tabs: detailActions.tabs })
      formIntel.push({ page: 'CapDetail_sample', actions: detailActions.actions, tabs: detailActions.tabs, urlRedacted: detailActions.urlRedacted })

      // Click Attachments / Documents tab if present (read-only)
      const docTab = page.locator('a').filter({ hasText: /attachment|document/i }).first()
      if (await docTab.count()) {
        const tabText = await docTab.innerText().catch(() => 'doc-tab')
        if (!isDangerous(tabText)) {
          console.log('[phase6] open doc/attachment tab')
          await docTab.click({ force: true }).catch(() => null)
          await waitQuiet(page, 2000)
          docFindings.push({ page: 'CapDetail_attachments_tab', ...(await scanDocumentRequirements(page)) })
          draftCleanup.pages.push({ page: 'CapDetail_attachments_tab', ...(await scanDraftCleanupControls(page)) })
          await page.screenshot({ path: path.join(OUT_DIR, 'cap-detail-docs.png'), fullPage: true }).catch(() => null)
        }
      }
      await page.screenshot({ path: path.join(OUT_DIR, 'cap-detail-sample.png'), fullPage: true }).catch(() => null)
    } else {
      notes.push('No CapDetail link found on MyRecords to sample actions')
    }

    // ── Shopping cart (fee page structure; no pay) ──
    console.log('[nav] ShoppingCart (no pay)')
    await page.goto('https://aca-prod.accela.com/POLKCO/ShoppingCart/ShoppingCart.aspx?TabName=Home&stepNumber=2', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page, 1500)
    draftCleanup.pages.push({ page: 'ShoppingCart', ...(await scanDraftCleanupControls(page)) })
    docFindings.push({ page: 'ShoppingCart', ...(await scanDocumentRequirements(page)) })
    const cartBtns = await page.evaluate(function () {
      function visible(el) {
        if (!el) return false
        var s = window.getComputedStyle(el)
        if (s.display === 'none' || s.visibility === 'hidden') return false
        return el.getBoundingClientRect().width > 0
      }
      return Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
        .filter(visible)
        .map(function (el) {
          return {
            text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            id: el.id || null,
          }
        })
        .filter(function (b) { return b.text })
        .slice(0, 30)
    })
    formIntel.push({ page: 'ShoppingCart', buttons: cartBtns })

    // ── Account manager (read-only glance — no settings change) ──
    console.log('[nav] AccountManager (read-only)')
    await page.goto('https://aca-prod.accela.com/POLKCO/Account/AccountManager.aspx', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page, 1500)
    docFindings.push({ page: 'AccountManager', ...(await scanDocumentRequirements(page)) })
    draftCleanup.pages.push({ page: 'AccountManager', ...(await scanDraftCleanupControls(page)) })

    // ── Draft cleanup verdict ──
    const allControls = []
    for (const p of draftCleanup.pages) {
      for (const c of (p.controls || [])) {
        allControls.push({ page: p.page, ...c })
      }
    }
    const deleteLike = allControls.filter((c) =>
      /delete|discard|abandon|withdraw|void|remove\s+(from\s+)?(cart|list|collection)?/i.test(c.text || '') ||
      /delete|discard|abandon/i.test(c.onclickHint || '')
    )
    const resumeLike = allControls.filter((c) => /save\s+and\s+resume|resume\s+application/i.test(c.text || '') || /doSaveAndResume|resume/i.test(c.onclickHint || ''))
    const removeFromCart = allControls.filter((c) => /remove/i.test(c.text || '') && /cart|ShoppingCart/i.test(c.page + (c.href || '')))

    draftCleanup.evidence = {
      deleteLikeControls: deleteLike.slice(0, 20),
      resumeLikeControls: resumeLike.slice(0, 15),
      removeFromCartControls: removeFromCart.slice(0, 10),
    }

    if (deleteLike.some((c) => /discard|abandon|delete\s+(draft|application|record)/i.test(c.text || ''))) {
      draftCleanup.verdict = 'YES — portal exposes discard/delete-application style control(s); located but NOT used'
    } else if (deleteLike.length) {
      draftCleanup.verdict = 'PARTIAL — delete/remove style controls found (often cart/collection); confirm before treating as draft discard'
    } else if (resumeLike.length) {
      draftCleanup.verdict = 'UNCLEAR for discard — Save/Resume present in runner config path, but no dedicated Discard/Delete Draft control observed on sampled pages'
    } else {
      draftCleanup.verdict = 'NO clear discard/delete-draft control observed on CapHome/MyRecords/CapDetail sample/Cart/Account (Batch B read-only scan)'
    }
    console.log('[draft-cleanup]', draftCleanup.verdict)

    // Return to dashboard
    await page.goto('https://aca-prod.accela.com/POLKCO/Dashboard.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null)

    // Dedupe network log
    const netDedup = []
    const seenNet = new Set()
    for (const n of networkLog) {
      const key = n.method + ' ' + n.url
      if (seenNet.has(key)) continue
      seenNet.add(key)
      netDedup.push(n)
      if (netDedup.length >= 120) break
    }

    const report = {
      generatedAt: new Date().toISOString(),
      batch: 'B',
      phases: ['3_conditional_logic', '4_form_field_intelligence', '5_network_observation', '6_document_requirements', 'draft_cleanup_locate'],
      companyId: COMPANY_ID,
      ahjId: AHJ_ID,
      configPath: 'automation/ahjs/configs/polk-county.config.js',
      safety,
      notes: notes.map(redact),
      conditionalFindings,
      formIntel,
      documentRequirements: docFindings,
      networkObservation: {
        requestCountLogged: networkLog.length,
        uniqueSample: netDedup,
        patterns: summarizeNetwork(netDedup),
      },
      draftCleanup,
    }

    const outJson = path.join(OUT_DIR, 'batch-b-findings.json')
    fs.writeFileSync(outJson, JSON.stringify(report, null, 2))
    console.log('[done] wrote', outJson)
    console.log('[done] attestation accepted: NO')
    console.log('[done] draftCleanup.verdict:', draftCleanup.verdict)
  } finally {
    await browser.close()
  }
}

function summarizeNetwork(entries) {
  const byPath = {}
  for (const e of entries) {
    let pathOnly = e.url
    try {
      const u = new URL(e.url.replace(/…$/, ''))
      pathOnly = u.pathname
    } catch (err) {
      pathOnly = String(e.url).split('?')[0]
    }
    byPath[pathOnly] = (byPath[pathOnly] || 0) + 1
  }
  return Object.entries(byPath)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([pathOnly, count]) => ({ path: pathOnly, count }))
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  console.error(e.stack)
  process.exit(1)
})
