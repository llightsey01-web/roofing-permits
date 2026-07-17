'use strict'

/**
 * Sync Florida Building Commission product approvals into Supabase.
 *
 * - Scrapes FBC for known roofing manufacturers (2023 code)
 * - Downloads approval PDFs (II → NOA → AE; skips COI)
 * - Uploads PDFs to job-documents/product-approvals/
 * - Upserts product_approvals rows
 * - Marks expired approvals
 * - Logs a platform_metrics marker for 30-day scheduling
 *
 * Manual:  node scripts/sync-product-approvals.js
 *          npm run sync:product-approvals
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

const { createClient } = require('@supabase/supabase-js')
const {
  selectProductApprovalPdfFromPage,
  normalizeFlNumber,
} = require('../lib/products/verify-fl-number')

const SYNC_METRIC_NAME = 'product_approvals_sync'
const SYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

const MANUFACTURERS = {
  'Air Vent': ['3126'],
  'ATAS International': ['3503'],
  Atlas: ['2472'],
  Boral: ['2387'],
  CertainTeed: ['1836'],
  'Eagle Roofing': ['5875'],
  GAF: ['1915'],
  Grace: ['4178'],
  Henry: ['1826'],
  IKO: ['3834'],
  Lomanco: ['3605'],
  'Metal Sales': ['2670'],
  'Owens Corning': ['1838', '2688'],
  Polyglass: ['2525'],
  TAMKO: ['2429'],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function safeFl(fl) {
  return String(fl).replace(/[^\w.-]/g, '_')
}

function layerFromSubcategory(sub, cat) {
  const s = `${sub || ''} ${cat || ''}`.toLowerCase()
  if (/underlay/.test(s)) return 'underlayment'
  if (/accessor|vent|ridge/.test(s)) return 'ventilation'
  if (/shingle|tile|metal roof|modified bitumen|built up/.test(s)) return 'primary'
  if (/insulat|waterproof|cement|adhesive|coating/.test(s)) return 'underlayment'
  if (/roof/.test(s)) return 'primary'
  return 'primary'
}

function parseGrid(html) {
  const apps = []
  const re =
    /<a href="(\.\.\/pr\/pr_app_dtl\.aspx\?param=([^"]+))"[^>]*>\s*(FL[\dA-Za-z.\-]+)\s*<\/a>[\s\S]*?<td>\s*([^<]+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/gi
  let m
  while ((m = re.exec(html))) {
    const fl = m[3].trim()
    const type = m[4].trim()
    const mfrBlock = m[5].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const status = m[7].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const cat =
      (mfrBlock.match(/Category:\s*(.+?)(?:\s*Subcategory:|$)/i) || [])[1]?.trim() || null
    const sub = (mfrBlock.match(/Subcategory:\s*(.+)$/i) || [])[1]?.trim() || null
    apps.push({
      fl,
      type,
      manufacturer: mfrBlock.split(/Category:/i)[0].trim(),
      category: cat,
      subcategory: sub,
      status,
      detailUrl: 'https://floridabuilding.org/pr/pr_app_dtl.aspx?param=' + m[2],
    })
  }
  if (!apps.length) {
    const linkRe =
      /<a href="\.\.\/pr\/pr_app_dtl\.aspx\?param=([^"]+)"[^>]*>\s*(FL[\dA-Za-z.\-]+)\s*<\/a>/gi
    while ((m = linkRe.exec(html))) {
      apps.push({
        fl: m[2].trim(),
        detailUrl: 'https://floridabuilding.org/pr/pr_app_dtl.aspx?param=' + m[1],
        status: null,
        category: null,
        subcategory: null,
        manufacturer: null,
      })
    }
  }
  return apps
}

function parseProductNames(products, fallbackName) {
  const names = []
  for (const raw of products || []) {
    const line = String(raw).trim()
    if (!line || /^FL\s*#?\s*Model/i.test(line) || /page\s*\d+\s*\/\s*\d+/i.test(line)) continue
    if (/\t/.test(line)) {
      const parts = line.split('\t').map((p) => p.trim()).filter(Boolean)
      let model = parts.length >= 2 ? parts[1] : parts[0]
      model = model.replace(/^\d+\s*[-–.)]\s*/, '').replace(/^["']|["']$/g, '').trim()
      if (model.length >= 2 && model.length <= 200 && !/page\s*\d+/i.test(model)) names.push(model)
    }
  }
  const seen = new Set()
  const out = []
  for (const n of names) {
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    if (/validation|engineer|phone|approved|pending|select/i.test(n)) continue
    seen.add(k)
    out.push(n)
  }
  if (!out.length && fallbackName) out.push(String(fallbackName).slice(0, 200))
  return out.slice(0, 25)
}

function extractDetailFields(text) {
  const get = (label) => {
    const re = new RegExp(label + '\\s*[:\\t]+\\s*([^\\n]+)', 'i')
    const m = text.match(re)
    return m ? m[1].trim() : null
  }
  const products = []
  const prodSection = text.match(
    /Product(?:s)?\s*\n([\s\S]{0,8000}?)(?:Quality Assurance|Limits of Use|Installation|Certification|Comments|$)/i
  )
  if (prodSection) {
    for (const line of prodSection[1].split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (/^(Model|Product Name|FL#|Type|Description|Name)$/i.test(line)) continue
      if (line.length >= 2 && line.length <= 200) products.push(line)
    }
  }
  return {
    status: get('Application Status') || get('Status'),
    category: get('Category'),
    subcategory: get('Subcategory'),
    effectiveDate: get('Effective Date') || get('Date Approved') || get('Approved Date'),
    expirationDate: get('Expiration Date') || get('Valid Through') || get('Expires'),
    productDescription: get('Product Description') || get('Description'),
    products,
  }
}

function isApprovedRoofing(app) {
  const st = (app.status || '').toLowerCase()
  if (/pending|denied|withdrawn|archived|applied for/.test(st)) return false
  if (st && !/approved/.test(st)) return false
  const cat = `${app.category || ''} ${app.subcategory || ''}`
  if (/roof/i.test(cat)) return true
  if (!app.category) return true
  return false
}

function createSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

async function searchManufacturer(page, mfrId) {
  await page.goto('https://floridabuilding.org/pr/pr_app_srch.aspx', {
    waitUntil: 'networkidle',
    timeout: 90000,
  })
  await sleep(800)
  await page.selectOption('#lstCodeVersion_drpCustomDropdown', { label: '2023' })
  await page.selectOption('#lstManufacturer_drpCustomDropdown', mfrId)
  await sleep(200)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
    page.click('#lnkSearch'),
  ])
  await sleep(2000)
}

async function scrapeAllPages(page) {
  const all = []
  const seen = new Set()
  let totalPages = 1
  const totalEl = await page.$('#pagTopPager_lblTotalPages, #pagBottomPager_lblTotalPages')
  if (totalEl) {
    const t = parseInt((await totalEl.innerText()).trim(), 10)
    if (t > 0) totalPages = t
  }
  const body = await page.innerText('body')
  if (/There are no records that match the search criteria/i.test(body)) {
    return []
  }
  for (let p = 1; p <= totalPages; p++) {
    for (const a of parseGrid(await page.content())) {
      if (seen.has(a.fl)) continue
      seen.add(a.fl)
      all.push(a)
    }
    if (p >= totalPages) break
    const next = await page.$('#pagTopPager_lnkNext, input[name="pagTopPager:lnkNext"]')
    if (!next) break
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
      next.click(),
    ])
    await sleep(1200)
  }
  return all
}

async function uploadPdf(supabase, flNumber, pdfBuffer) {
  const storagePath = `product-approvals/${flNumber}.pdf`
  const { error } = await supabase.storage.from('job-documents').upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw error
  return storagePath
}

async function upsertProduct(supabase, row) {
  const payload = {
    manufacturer: row.manufacturer,
    product_name: row.product_name,
    approval_number: row.approval_number,
    fl_approval_number: row.fl_approval_number,
    layer_type: row.layer_type,
    is_active: row.is_active,
    is_expired: row.is_expired,
    pdf_path: row.pdf_path,
    last_synced_at: new Date().toISOString(),
    category: row.category,
    subcategory: row.subcategory,
    approval_status: row.approval_status,
    effective_date: row.effective_date,
    expiration_date: row.expiration_date,
  }

  // Prefer unique (manufacturer, product_name) if present
  const { data: existing } = await supabase
    .from('product_approvals')
    .select('id')
    .eq('manufacturer', row.manufacturer)
    .eq('product_name', row.product_name)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabase.from('product_approvals').update(payload).eq('id', existing.id)
    if (error) throw error
    return { action: 'update', id: existing.id }
  }

  const { data, error } = await supabase.from('product_approvals').insert(payload).select('id').single()
  if (error) throw error
  return { action: 'insert', id: data.id }
}

async function logSyncMetric(supabase, summary) {
  const today = new Date().toISOString().slice(0, 10)
  const row = {
    metric_name: SYNC_METRIC_NAME,
    metric_date: today,
    metric_value: summary.upserted || 0,
    metadata: summary,
  }
  const { data: existing } = await supabase
    .from('platform_metrics')
    .select('id')
    .eq('metric_name', SYNC_METRIC_NAME)
    .eq('metric_date', today)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('platform_metrics')
      .update({ metric_value: row.metric_value, metadata: summary })
      .eq('id', existing.id)
  } else {
    await supabase.from('platform_metrics').insert(row)
  }
}

async function getLastSyncAt(supabase) {
  const { data } = await supabase
    .from('platform_metrics')
    .select('metric_date, metadata, created_at')
    .eq('metric_name', SYNC_METRIC_NAME)
    .order('metric_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  if (data.metadata?.finishedAt) return new Date(data.metadata.finishedAt)
  if (data.created_at) return new Date(data.created_at)
  if (data.metric_date) return new Date(data.metric_date + 'T00:00:00.000Z')
  return null
}

/**
 * Full FBC → Storage → product_approvals sync.
 * @param {object} [options]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {boolean} [options.headless=true]
 * @param {boolean} [options.skipMetrics=false]
 */
async function syncProductApprovals(options) {
  const opts = options || {}
  const supabase = opts.supabase || createSupabase()
  const headless = opts.headless !== false

  let chromium
  try {
    chromium = require('playwright').chromium
  } catch (e) {
    throw new Error('playwright is required for product approval sync: ' + e.message)
  }

  const summary = {
    startedAt: new Date().toISOString(),
    manufacturers: {},
    appsFound: 0,
    detailsVisited: 0,
    pdfOk: 0,
    pdfFail: 0,
    uploadOk: 0,
    uploadFail: 0,
    upserted: 0,
    upsertErrors: 0,
    strategyCounts: {},
    errors: [],
  }

  console.log('[sync-product-approvals] Starting FBC sync…')
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage()

  try {
    const allApps = []
    for (const [mfr, ids] of Object.entries(MANUFACTURERS)) {
      summary.manufacturers[mfr] = 0
      for (const id of ids) {
        console.log(`[sync-product-approvals] Search ${mfr} id=${id}`)
        try {
          await searchManufacturer(page, id)
          const apps = await scrapeAllPages(page)
          for (const a of apps) {
            allApps.push({ ...a, searchMfr: mfr, mfrId: id })
          }
          summary.manufacturers[mfr] += apps.length
          console.log(`[sync-product-approvals]   → ${apps.length} apps`)
        } catch (e) {
          console.error(`[sync-product-approvals] ${mfr} failed:`, e.message)
          summary.errors.push({ manufacturer: mfr, id, error: e.message })
        }
        await sleep(600)
      }
    }

    // Dedupe by FL
    const byFl = new Map()
    for (const a of allApps) byFl.set(a.fl, a)
    const uniqueApps = [...byFl.values()]
    summary.appsFound = uniqueApps.length

    const toVisit = uniqueApps.filter(isApprovedRoofing)
    console.log(
      `[sync-product-approvals] ${uniqueApps.length} apps, visiting ${toVisit.length} approved roofing`
    )

    const scrapedFls = []

    for (let i = 0; i < toVisit.length; i++) {
      const app = toVisit[i]
      const flKey = safeFl(app.fl)
      summary.detailsVisited++
      console.log(`[sync-product-approvals] [${i + 1}/${toVisit.length}] ${app.fl}`)

      try {
        await page.goto(app.detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await sleep(900)
        const text = await page.innerText('body')
        const fields = extractDetailFields(text)
        const category = fields.category || app.category
        const subcategory = fields.subcategory || app.subcategory
        const status = (fields.status || app.status || '').replace(/\s*\*$/, '').trim() || 'Approved'

        let pdfPath = null
        const picked = await selectProductApprovalPdfFromPage(page)
        if (picked?.href) {
          summary.strategyCounts[picked.strategy] =
            (summary.strategyCounts[picked.strategy] || 0) + 1
          try {
            const resp = await page.request.get(picked.href)
            const buf = Buffer.from(await resp.body())
            if (resp.ok() && buf.slice(0, 4).toString() === '%PDF') {
              summary.pdfOk++
              try {
                pdfPath = await uploadPdf(supabase, flKey, buf)
                summary.uploadOk++
              } catch (upErr) {
                summary.uploadFail++
                console.error('[sync-product-approvals] upload failed', flKey, upErr.message)
              }
            } else {
              summary.pdfFail++
            }
          } catch (pdfErr) {
            summary.pdfFail++
            console.error('[sync-product-approvals] pdf fetch failed', flKey, pdfErr.message)
          }
        } else {
          summary.pdfFail++
        }

        const expRaw = fields.expirationDate
        const expDate =
          expRaw && !Number.isNaN(Date.parse(expRaw)) ? new Date(expRaw).toISOString().slice(0, 10) : null
        const effRaw = fields.effectiveDate
        const effDate =
          effRaw && !Number.isNaN(Date.parse(effRaw)) ? new Date(effRaw).toISOString().slice(0, 10) : null
        const isExpired =
          /expired/i.test(status) || (expDate && new Date(expDate) < new Date())
        const isActive = /approved/i.test(status) && !isExpired

        const fallbackName =
          fields.productDescription?.slice(0, 120) ||
          subcategory ||
          `${app.searchMfr} ${app.fl}`
        const names = parseProductNames(fields.products, fallbackName)
        const flNorm = normalizeFlNumber(app.fl)
        const approvalNumber = flNorm.full || app.fl

        for (const productName of names) {
          try {
            await upsertProduct(supabase, {
              manufacturer: app.searchMfr,
              product_name: productName,
              approval_number: approvalNumber,
              fl_approval_number: approvalNumber,
              layer_type: layerFromSubcategory(subcategory, category),
              is_active: isActive,
              is_expired: !!isExpired,
              pdf_path: pdfPath,
              category,
              subcategory,
              approval_status: status,
              effective_date: effDate,
              expiration_date: expDate,
            })
            summary.upserted++
          } catch (upErr) {
            summary.upsertErrors++
            console.error('[sync-product-approvals] upsert failed', productName, upErr.message)
          }
        }

        scrapedFls.push(approvalNumber)
      } catch (e) {
        summary.errors.push({ fl: app.fl, error: e.message })
        console.error('[sync-product-approvals] detail failed', app.fl, e.message)
      }
      await sleep(400)
    }

    // Flag rows whose FL base is not in this scrape as expired
    if (scrapedFls.length) {
      const bases = new Set(
        scrapedFls.map((fl) => String(fl).replace(/^FL/i, '').replace(/-R\d+$/i, ''))
      )
      const { data: existingRows } = await supabase
        .from('product_approvals')
        .select('id, approval_number, fl_approval_number, is_expired')
        .eq('is_expired', false)

      for (const row of existingRows || []) {
        const raw = row.fl_approval_number || row.approval_number || ''
        const base = String(raw)
          .replace(/^FL\s*#?\s*/i, '')
          .replace(/-R\d+$/i, '')
        if (base && !bases.has(base)) {
          await supabase
            .from('product_approvals')
            .update({ is_expired: true, last_synced_at: new Date().toISOString() })
            .eq('id', row.id)
        }
      }
    }
  } finally {
    await browser.close()
  }

  summary.finishedAt = new Date().toISOString()
  if (!opts.skipMetrics) {
    try {
      await logSyncMetric(supabase, summary)
    } catch (e) {
      console.error('[sync-product-approvals] metrics log failed:', e.message)
      summary.errors.push({ metrics: e.message })
    }
  }

  console.log('[sync-product-approvals] Done:', JSON.stringify({
    appsFound: summary.appsFound,
    detailsVisited: summary.detailsVisited,
    pdfOk: summary.pdfOk,
    uploadOk: summary.uploadOk,
    upserted: summary.upserted,
    strategyCounts: summary.strategyCounts,
  }))
  return summary
}

/**
 * Ops-worker helper: run sync at most once every 30 days.
 */
function createProductApprovalsSyncScheduler(supabase, options) {
  const opts = options || {}
  let running = false
  let lastAttemptAt = null

  async function maybeSyncProductApprovals() {
    if (running) return { skipped: true, reason: 'in_progress' }
    if (opts.force) {
      running = true
      try {
        return await syncProductApprovals({ supabase, headless: opts.headless !== false })
      } finally {
        running = false
      }
    }

    const now = Date.now()
    if (lastAttemptAt && now - lastAttemptAt < 60 * 60 * 1000) {
      return { skipped: true, reason: 'attempted_within_hour' }
    }

    const last = await getLastSyncAt(supabase)
    if (last && now - last.getTime() < SYNC_INTERVAL_MS) {
      return {
        skipped: true,
        reason: 'within_30_days',
        lastSyncAt: last.toISOString(),
        nextDueAt: new Date(last.getTime() + SYNC_INTERVAL_MS).toISOString(),
      }
    }

    lastAttemptAt = now
    running = true
    try {
      console.log('[ops-worker] Running 30-day product approvals sync…')
      const result = await syncProductApprovals({ supabase, headless: opts.headless !== false })
      return result
    } finally {
      running = false
    }
  }

  return {
    maybeSyncProductApprovals,
    SYNC_INTERVAL_MS,
    SYNC_METRIC_NAME,
  }
}

module.exports = {
  syncProductApprovals,
  createProductApprovalsSyncScheduler,
  getLastSyncAt,
  MANUFACTURERS,
  SYNC_METRIC_NAME,
  SYNC_INTERVAL_MS,
}

if (require.main === module) {
  syncProductApprovals({})
    .then((summary) => {
      if (summary.errors?.length) {
        console.error('[sync-product-approvals] Completed with errors:', summary.errors.length)
        process.exitCode = 1
      }
    })
    .catch((err) => {
      console.error('[sync-product-approvals] Fatal:', err.message)
      process.exit(1)
    })
}
