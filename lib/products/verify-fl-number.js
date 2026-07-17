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

module.exports = {
  scoreApprovalPdf,
  selectProductApprovalPdf,
  selectProductApprovalPdfFromPage,
  normalizeFlNumber,
  isCoiLink,
  isInstallationInstructionsLink,
  isNoaLink,
  isEvaluationReportLink,
  COI_RE,
}
