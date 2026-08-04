/**
 * Batch A2 — Polk Accela permit-history pattern analysis (view-only).
 * Pulls existing MyRecords / CapHome grid rows into gitignored tmp/polk-batch-a2/.
 * Chat-facing output is AGGREGATES ONLY (no permit numbers / addresses / owner names).
 *
 * NEVER submit / pay / delete / cancel / schedule / attest / email.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID,
 * TWOCAPTCHA_API_KEY.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   TWOCAPTCHA_API_KEY=... node scripts/diagnostics/ahj-discovery/polk-batch-a2-history.js
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
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a2')
const STORAGE_CANDIDATES = [
  path.join(OUT_DIR, 'storageState-polk-gator.json'),
  path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-b', 'storageState-polk-gator.json'),
  path.join(__dirname, '..', '..', '..', 'tmp', 'polk-batch-a', 'storageState-polk-gator.json'),
]
const STORAGE_OUT = path.join(OUT_DIR, 'storageState-polk-gator.json')

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

function bump(map, key) {
  const k = key || '(blank)'
  map[k] = (map[k] || 0) + 1
}

function yearFromPermit(altId) {
  const m = String(altId || '').match(/\b[A-Z]{1,4}-(\d{4})-\d+\b/i)
  return m ? m[1] : null
}

function isPermitId(s) {
  return /^[A-Z]{1,4}-\d{4}-\d+$/i.test(String(s || '').trim())
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

/** Extract CapDetail data rows only — RAW stays in tmp */
async function extractGridPage(page) {
  return page.evaluate(function () {
    function clean(s) {
      return String(s || '').replace(/\s+/g, ' ').trim()
    }
    var showing = null
    var body = (document.body && document.body.innerText) || ''
    var m = body.match(/Showing\s+\d+\s*-\s*\d+\s+of\s+\d+/i)
    if (m) showing = m[0]

    var rows = []
    // Only rows that contain a CapDetail link = real record rows
    document.querySelectorAll('tr').forEach(function (tr) {
      var link = tr.querySelector('a[href*="CapDetail"]')
      if (!link) return
      // Skip if inside a nested non-grid chrome (rare)
      var cells = Array.from(tr.querySelectorAll(':scope > td')).map(function (td) {
        return clean(td.innerText)
      })
      if (!cells.length) {
        cells = Array.from(tr.querySelectorAll('td')).map(function (td) { return clean(td.innerText) })
      }
      var altId = clean(link.innerText)
      if (!/^[A-Z]{1,4}-\d{4}-\d+$/i.test(altId)) {
        altId = cells.find(function (c) { return /^[A-Z]{1,4}-\d{4}-\d+$/i.test(c) }) || altId
      }
      // Accela MyRecords layout (observed):
      // [0]=checkbox cell, [1]=Record Number, [2]=Record Type, [3]=Address,
      // [4]=Action, [5]=Status, [6]=Date, [7]=Project Name, [8]=Description...
      rows.push({
        altId: altId,
        cells: cells,
        hasCapDetailLink: true,
        recordType: cells[2] || null,
        address: cells[3] || null,
        status: cells[5] || null,
        date: cells[6] || null,
        projectName: cells[7] || null,
      })
    })

    return {
      headers: [
        'Record Number', 'Record Type', 'Address', 'Action', 'Status',
        'Date', 'Project Name', 'Description', 'Expiration Date', 'Short Notes',
      ],
      rows: rows,
      showingText: showing,
    }
  })
}

async function clickNextPage(page) {
  const next = page.locator('a').filter({ hasText: /^\s*Next\s*>\s*$/i }).first()
  if (!(await next.count())) return false
  const cls = ((await next.getAttribute('class').catch(() => '')) || '')
  const href = ((await next.getAttribute('href').catch(() => '')) || '')
  if (/disabled|ACA_Pager_Disabled/i.test(cls)) return false
  if (/CapDetail/i.test(href)) return false
  await next.click({ force: true }).catch(() => null)
  await waitQuiet(page)
  return true
}

function classifyRow(row) {
  const status = row.status || ''
  const type = row.recordType || ''
  const date = row.date || ''
  const altId = row.altId || null
  const year = yearFromPermit(altId) || (String(date).match(/\b(20\d{2})\b/) || [])[1] || null
  return {
    altId,
    status: status || '(unknown)',
    type: type || '(unknown)',
    module: 'Building',
    year: year || '(unknown)',
    isReroof: /re-?roof|roof/i.test(type),
    isIncomplete: /incomplete|draft|temporary|in progress/i.test(status),
  }
}

function aggregate(classified) {
  const byStatus = {}
  const byType = {}
  const byYear = {}
  const byModule = {}
  let reroof = 0
  let incomplete = 0
  const prefix = {}
  const valid = classified.filter((r) => isPermitId(r.altId))

  for (const r of valid) {
    if (!isPermitId(r.status) && !/^Showing\s+/i.test(r.status) && r.status !== '|') {
      bump(byStatus, r.status)
    }
    if (!isPermitId(r.type) && !/^Showing\s+/i.test(r.type) && r.type !== '|' && !/< Prev|Next >/i.test(r.type) && !/Add to collection/i.test(r.type)) {
      bump(byType, r.type)
    }
    bump(byYear, r.year)
    bump(byModule, r.module)
    if (r.isReroof) reroof++
    if (r.isIncomplete) incomplete++
    bump(prefix, String(r.altId).split('-')[0])
  }

  function top(map, n) {
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n || 40)
      .map(([k, v]) => ({ key: k, count: v }))
  }

  // Safety: summary must never contain permit-number-shaped keys
  function assertClean(list, label) {
    for (const item of list) {
      if (isPermitId(item.key)) {
        throw new Error('Aggregate leak (' + label + '): ' + item.key)
      }
    }
  }
  const out = {
    totalRows: valid.length,
    uniqueAltIds: new Set(valid.map((r) => r.altId)).size,
    reroofRelatedCount: reroof,
    incompleteOrDraftCount: incomplete,
    byStatus: top(byStatus),
    byType: top(byType),
    byYear: top(byYear),
    byModule: top(byModule),
    permitNumberPrefix: top(prefix),
  }
  assertClean(out.byStatus, 'byStatus')
  assertClean(out.byType, 'byType')
  return out
}

async function scrapeAllPages(page, label, maxPages) {
  const allRaw = []
  const classified = []
  let pageNum = 0
  let prevSig = ''

  while (pageNum < (maxPages || 20)) {
    pageNum++
    console.log('[' + label + '] page', pageNum)
    const raw = await extractGridPage(page)
    console.log('[' + label + '] rows=', (raw.rows || []).length, raw.showingText || '')
    const sig = JSON.stringify((raw.rows || []).slice(0, 3).map((r) => r.altId))
    if (sig && sig === prevSig) {
      console.log('[' + label + '] pager did not advance — stop')
      break
    }
    prevSig = sig

    allRaw.push({
      pageNum,
      showingText: raw.showingText,
      headers: raw.headers,
      rowCount: (raw.rows || []).length,
      rows: raw.rows,
    })
    for (const row of raw.rows || []) {
      classified.push(classifyRow(row))
    }

    if (!(raw.rows || []).length) break
    const advanced = await clickNextPage(page)
    if (!advanced) {
      console.log('[' + label + '] no Next > — stop')
      break
    }
  }

  return { allRaw, classified, pagesScraped: pageNum }
}

async function main() {
  ensureOut()
  console.log('=== Batch A2 permit-history pattern analysis (fixed) ===')
  console.log('Raw → tmp/polk-batch-a2/ ; chat report = aggregates only')

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

  try {
    await login(page, credentials, solver)
    await context.storageState({ path: STORAGE_OUT })

    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/MyRecordsCap.aspx', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page)
    const myRec = await scrapeAllPages(page, 'MyRecords', 12)

    // CapHome often mirrors MyRecords — scrape once for comparison, don't double-count in combined
    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/CapHome.aspx?module=Building&TabName=Building', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await waitQuiet(page)
    const capHome = await scrapeAllPages(page, 'CapHome', 12)

    const raw = {
      generatedAt: new Date().toISOString(),
      companyId: COMPANY_ID,
      ahjId: AHJ_ID,
      safety: {
        submitted: false,
        paid: false,
        deleted: false,
        cancelled: false,
        scheduledInspection: false,
        acceptedAttestation: false,
      },
      myRecords: myRec.allRaw,
      capHome: capHome.allRaw,
      classifiedMyRecords: myRec.classified,
      classifiedCapHome: capHome.classified,
    }
    fs.writeFileSync(path.join(OUT_DIR, 'raw-history.json'), JSON.stringify(raw, null, 2))
    console.log('[done] raw →', path.join(OUT_DIR, 'raw-history.json'))

    const combined = (() => {
      const seen = new Set()
      const out = []
      for (const r of [...myRec.classified, ...capHome.classified]) {
        if (!isPermitId(r.altId)) continue
        if (seen.has(r.altId)) continue
        seen.add(r.altId)
        out.push(r)
      }
      return out
    })()

    const summary = {
      generatedAt: new Date().toISOString(),
      note: 'AGGREGATES ONLY — no permit numbers, addresses, or owner names',
      sources: {
        myRecordsPages: myRec.pagesScraped,
        capHomePages: capHome.pagesScraped,
        portalShowingHint: (myRec.allRaw[0] && myRec.allRaw[0].showingText) || null,
      },
      myRecords: aggregate(myRec.classified),
      capHome: aggregate(capHome.classified),
      combined: aggregate(combined),
    }
    fs.writeFileSync(path.join(OUT_DIR, 'pattern-summary.json'), JSON.stringify(summary, null, 2))
    console.log('[done] summary →', path.join(OUT_DIR, 'pattern-summary.json'))
    console.log('[aggregate] combined unique=', summary.combined.uniqueAltIds, 'rows=', summary.combined.totalRows)
    console.log('[aggregate] byStatus=', JSON.stringify(summary.combined.byStatus))
    console.log('[aggregate] byType=', JSON.stringify(summary.combined.byType))
    console.log('[aggregate] byYear=', JSON.stringify(summary.combined.byYear))
    console.log('[aggregate] prefix=', JSON.stringify(summary.combined.permitNumberPrefix))
    console.log('[aggregate] reroofRelated=', summary.combined.reroofRelatedCount, 'incomplete=', summary.combined.incompleteOrDraftCount)

    // Final leak check for chat safety
    const s = JSON.stringify(summary)
    if (/\b[A-Z]{1,4}-\d{4}-\d+\b/i.test(s)) {
      throw new Error('pattern-summary.json still contains permit-number tokens — abort')
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  console.error(e.stack)
  process.exit(1)
})
