/**
 * Select the best Florida product-approval PDF from an FBC detail page.
 *
 * Typical FBC attachments:
 *   - PR_Independence / _COI_     → Certificate of Independence (SKIP)
 *   - PR_Instl_Docs / _II_        → Installation Instructions (PREFERRED —
 *                                   Miami-Dade NOAs are often embedded here)
 *   - PR_Certificate / CAC_NOA_*  → Explicit NOA certificate (secondary)
 *   - PR_Tech_Docs / _AE_         → Evaluation Report / PEER (last resort)
 *
 * Priority:
 *   1. Installation Instructions (II / PR_Instl_Docs)
 *   2. Explicit NOA links
 *   3. Evaluation Report (AE)
 *   4. Any other non-COI PDF
 */

const COI_RE =
  /pr_independence|\/coi_|_coi_|certificate[_\s-]*of[_\s-]*independence/i

/**
 * @typedef {{ href: string, text?: string, parentText?: string }} PdfCandidate
 */

function isCoiLink(link) {
  const href = String(link.href || '')
  const text = String(link.text || '')
  const parent = String(link.parentText || '')
  return COI_RE.test(href) || COI_RE.test(text) || COI_RE.test(parent)
}

function isInstallationInstructionsLink(link) {
  const href = String(link.href || '')
  const text = String(link.text || '')
  const parent = String(link.parentText || '')
  const blob = `${href} ${text} ${parent}`
  return (
    /pr_instl_docs/i.test(href) ||
    /_ii_/i.test(href) ||
    /installation\s*instructions?/i.test(blob) ||
    /\binstl\b/i.test(blob)
  )
}

function isNoaLink(link) {
  const href = String(link.href || '')
  const text = String(link.text || '')
  const parent = String(link.parentText || '')
  const blob = `${href} ${text} ${parent}`
  return (
    /\bnoa\b|notice[_\s-]*of[_\s-]*acceptance|cac[_\s-]*noa|miami[_\s-]*dade/i.test(blob) ||
    (/pr_certificate/i.test(href) && /noa/i.test(href))
  )
}

function isEvaluationReportLink(link) {
  const href = String(link.href || '')
  const text = String(link.text || '')
  const parent = String(link.parentText || '')
  const blob = `${href} ${text} ${parent}`
  return (
    /pr_tech_docs/i.test(href) ||
    /_ae_/i.test(href) ||
    /evaluation report/i.test(blob)
  )
}

/** Prefer HVHZ variant when multiple II/AE docs exist. */
function hvhzBoost(link) {
  const blob = `${link.href || ''} ${link.text || ''} ${link.parentText || ''}`
  if (/non[-_]?hvhz/i.test(blob)) return -5
  if (/\bhvhz\b/i.test(blob)) return 10
  return 0
}

/**
 * Score a PDF link. Higher is better. Strongly negative = hard skip.
 * @param {PdfCandidate} link
 * @returns {number}
 */
function scoreApprovalPdf(link) {
  if (isCoiLink(link)) return -1000

  let score = 0
  if (isInstallationInstructionsLink(link)) score += 300
  if (isNoaLink(link)) score += 200
  if (isEvaluationReportLink(link)) score += 100
  if (/fl\d+/i.test(String(link.href || ''))) score += 5
  score += hvhzBoost(link)
  return score
}

/**
 * Pick the best product-approval PDF URL from candidates.
 * @param {PdfCandidate[]} links
 * @returns {{ href: string, text: string, score: number, strategy: string } | null}
 */
function selectProductApprovalPdf(links) {
  const pdfs = (links || []).filter((l) => /\.pdf($|\?)/i.test(l.href || ''))
  if (!pdfs.length) return null

  const nonCoi = pdfs.filter((l) => !isCoiLink(l))

  // Priority 1: Installation Instructions (may contain embedded Miami-Dade NOA)
  const iiCandidates = nonCoi
    .filter(isInstallationInstructionsLink)
    .map((l) => ({
      href: l.href,
      text: (l.text || '').trim(),
      score: scoreApprovalPdf(l),
    }))
    .sort((a, b) => b.score - a.score)
  if (iiCandidates.length) {
    return { ...iiCandidates[0], strategy: 'installation-instructions' }
  }

  // Priority 2: Explicit NOA link
  const noaCandidates = nonCoi
    .filter(isNoaLink)
    .map((l) => ({
      href: l.href,
      text: (l.text || '').trim(),
      score: scoreApprovalPdf(l),
    }))
    .sort((a, b) => b.score - a.score)
  if (noaCandidates.length) {
    return { ...noaCandidates[0], strategy: 'noa' }
  }

  // Priority 3: Evaluation Report
  const aeCandidates = nonCoi
    .filter(isEvaluationReportLink)
    .map((l) => ({
      href: l.href,
      text: (l.text || '').trim(),
      score: scoreApprovalPdf(l),
    }))
    .sort((a, b) => b.score - a.score)
  if (aeCandidates.length) {
    return { ...aeCandidates[0], strategy: 'evaluation-report' }
  }

  // Last resort: any non-COI PDF
  const ranked = nonCoi
    .map((l) => ({
      href: l.href,
      text: (l.text || '').trim(),
      score: scoreApprovalPdf(l),
    }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  return best ? { ...best, strategy: 'last-resort' } : null
}

/**
 * Playwright page helper — collect anchors and select the approval PDF.
 * @param {import('playwright').Page} page
 */
async function selectProductApprovalPdfFromPage(page) {
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => ({
      href: a.href || '',
      text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(),
      parentText: (a.closest('td, li, div, tr')?.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240),
    }))
  )
  return selectProductApprovalPdf(links)
}

/**
 * Lightweight FL number normalization: "FL #16305" / "FL16305-R14" → base + full.
 */
function normalizeFlNumber(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^FL\s*#?\s*/i, '')
    .replace(/\s+/g, '')
  const m = cleaned.match(/^(\d+)((?:\.\d+)?)((?:-R\d+)?)$/i)
  if (!m) return { raw, full: null, base: null }
  return {
    raw,
    full: `FL${m[1]}${m[2]}${m[3]}`,
    base: `FL${m[1]}`,
  }
}

function detectLayerType(name) {
  const n = (name || '').toLowerCase()
  if (/underlayment|felt|synthetic|moisture|ice|water|shield/i.test(n)) return 'underlayment'
  if (/vent|ridge|soffit|air/i.test(n)) return 'ventilation'
  return 'primary'
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Verify an FL number on floridabuilding.org and insert into product_approvals if new.
 *
 * @param {object} input
 * @param {string} input.manufacturer
 * @param {string} input.productName
 * @param {string} input.flNumber
 * @param {string} [input.layerType]
 * @param {string} [input.companyId]
 * @param {import('@supabase/supabase-js').SupabaseClient} input.supabase
 */
async function verifyAndAddProduct(input) {
  const manufacturer = String(input.manufacturer || '').trim()
  const productName = String(input.productName || '').trim()
  const flRaw = String(input.flNumber || '').trim()
  const layerType = input.layerType || detectLayerType(productName)
  const supabase = input.supabase

  if (!supabase) return { valid: false, error: 'Supabase client required' }
  if (!manufacturer) return { valid: false, error: 'Manufacturer is required' }
  if (!productName) return { valid: false, error: 'Product name is required' }
  if (!flRaw) return { valid: false, error: 'FL approval number is required' }

  const norm = normalizeFlNumber(flRaw)
  if (!norm.full && !norm.base) {
    return { valid: false, error: 'Invalid FL approval number format' }
  }
  const flFull = norm.full || norm.base
  const searchNum = String(flFull).replace(/^FL/i, '').replace(/-R\d+$/i, '')

  // 1) Existing product by approval_number / fl_approval_number
  const { data: byFl } = await supabase
    .from('product_approvals')
    .select('*')
    .ilike('approval_number', '%' + searchNum + '%')
    .limit(20)

  const { data: byFl2 } = await supabase
    .from('product_approvals')
    .select('*')
    .ilike('fl_approval_number', '%' + searchNum + '%')
    .limit(20)

  const existingRows = [...(byFl || []), ...(byFl2 || [])]
  const matchExisting = existingRows.find((p) => {
    const a = String(p.approval_number || '').replace(/\s|#/g, '').toUpperCase()
    const b = String(p.fl_approval_number || '').replace(/\s|#/g, '').toUpperCase()
    const want = flFull.replace(/\s|#/g, '').toUpperCase()
    const wantBase = String(searchNum).toUpperCase()
    return a === want || b === want || a.includes(wantBase) || b.includes(wantBase)
  })
  if (matchExisting) {
    const exact =
      existingRows.find(
        (p) =>
          p.id === matchExisting.id &&
          String(p.product_name || '').toLowerCase() === productName.toLowerCase()
      ) || matchExisting
    return { valid: true, product: exact, existed: true }
  }

  // Also match by manufacturer + product name
  const { data: byName } = await supabase
    .from('product_approvals')
    .select('*')
    .eq('manufacturer', manufacturer)
    .eq('product_name', productName)
    .maybeSingle()
  if (byName) return { valid: true, product: byName, existed: true }

  // 2) Verify on FBC
  let chromium
  try {
    chromium = require('playwright').chromium
  } catch (e) {
    return { valid: false, error: 'Playwright is required to verify FL numbers: ' + e.message }
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let pdfPath = null
  let fbcStatus = null
  let effectiveDate = null
  let expirationDate = null
  let fbcCategory = null
  let fbcSubcategory = null

  try {
    await page.goto('https://floridabuilding.org/pr/pr_app_srch.aspx', {
      waitUntil: 'networkidle',
      timeout: 90000,
    })
    await sleep(1000)
    await page.fill('#txtAppNum_txtTextbox', searchNum)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
      page.click('#lnkSearch'),
    ])
    await sleep(2000)

    const listText = await page.innerText('body')
    if (/There are no records that match the search criteria/i.test(listText)) {
      await browser.close()
      return {
        valid: false,
        error: 'FL approval number not found on Florida Building Commission',
      }
    }

    // Prefer a detail link matching our FL
    const detailHref = await page.evaluate((want) => {
      const links = [...document.querySelectorAll('a[href*="pr_app_dtl.aspx"]')]
      const match = links.find((a) => (a.innerText || '').replace(/\s/g, '').toUpperCase().includes(want))
      const pick = match || links[0]
      return pick ? pick.getAttribute('href') : null
    }, flFull.replace(/^FL/i, '').toUpperCase())

    if (!detailHref) {
      await browser.close()
      return {
        valid: false,
        error: 'FL approval number not found on Florida Building Commission',
      }
    }

    let detailUrl = detailHref
    if (detailUrl.startsWith('../')) detailUrl = 'https://floridabuilding.org/' + detailUrl.replace(/^\.\.\//, '')
    else if (detailUrl.startsWith('/')) detailUrl = 'https://floridabuilding.org' + detailUrl
    else if (!/^https?:/i.test(detailUrl)) detailUrl = 'https://floridabuilding.org/pr/' + detailUrl

    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(1200)
    const detailText = await page.innerText('body')

    const get = (label) => {
      const re = new RegExp(label + '\\s*[:\\t]+\\s*([^\\n]+)', 'i')
      const m = detailText.match(re)
      return m ? m[1].trim() : null
    }
    fbcStatus = get('Application Status') || get('Status')
    effectiveDate = get('Effective Date') || get('Date Approved')
    expirationDate = get('Expiration Date') || get('Valid Through')
    fbcCategory = get('Category')
    fbcSubcategory = get('Subcategory')

    if (/denied|withdrawn|archived/i.test(fbcStatus || '')) {
      await browser.close()
      return { valid: false, error: 'FL approval exists but status is ' + fbcStatus }
    }

    const picked = await selectProductApprovalPdfFromPage(page)
    if (picked?.href) {
      try {
        const resp = await page.request.get(picked.href)
        const buf = Buffer.from(await resp.body())
        if (resp.ok() && buf.slice(0, 4).toString() === '%PDF') {
          const storagePath = `product-approvals/${flFull}.pdf`
          const { error: upErr } = await supabase.storage
            .from('job-documents')
            .upload(storagePath, buf, { contentType: 'application/pdf', upsert: true })
          if (!upErr) pdfPath = storagePath
        }
      } catch (_) {
        // PDF optional — product can still be added
      }
    }
  } finally {
    await browser.close().catch(() => null)
  }

  const expDate =
    expirationDate && !Number.isNaN(Date.parse(expirationDate))
      ? new Date(expirationDate).toISOString().slice(0, 10)
      : null
  const effDate =
    effectiveDate && !Number.isNaN(Date.parse(effectiveDate))
      ? new Date(effectiveDate).toISOString().slice(0, 10)
      : null
  const isExpired = !!expDate && new Date(expDate) < new Date()

  const insertRow = {
    manufacturer,
    product_name: productName,
    approval_number: flFull,
    fl_approval_number: flFull,
    layer_type: layerType,
    is_active: !isExpired,
    is_expired: isExpired,
    pdf_path: pdfPath,
    last_synced_at: new Date().toISOString(),
    category: fbcCategory,
    subcategory: fbcSubcategory,
    approval_status: (fbcStatus || 'Approved').replace(/\s*\*$/, '').trim(),
    effective_date: effDate,
    expiration_date: expDate,
    needs_verification: false,
    verified_at: new Date().toISOString(),
    submitted_by_company_id: input.companyId || null,
  }

  const { data: created, error: insertError } = await supabase
    .from('product_approvals')
    .insert(insertRow)
    .select('*')
    .single()

  if (insertError) {
    return { valid: false, error: insertError.message }
  }

  return { valid: true, product: created, existed: false }
}

module.exports = {
  scoreApprovalPdf,
  selectProductApprovalPdf,
  selectProductApprovalPdfFromPage,
  normalizeFlNumber,
  detectLayerType,
  verifyAndAddProduct,
  isCoiLink,
  isInstallationInstructionsLink,
  isNoaLink,
  isEvaluationReportLink,
  COI_RE,
}
