'use strict'

require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SCRAPE_METRIC_NAME = 'ahj_forms_scrape'
const SCRAPE_INTERVAL_DAYS = 30

function createSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Keywords that indicate a roofing-related form
const ROOFING_KEYWORDS = [
  'roof', 're-roof', 'reroof', 'shingle', 'sheathing', 'affidavit',
  'notice of commencement', 'noc', 'permit application', 'building permit',
  'roofing permit', 'residential permit', 'construction permit',
  'owner builder', 'contractor affidavit', 'permit packet',
]

// Keywords to skip
const SKIP_KEYWORDS = [
  'electrical', 'plumbing', 'mechanical', 'hvac', 'pool', 'fence',
  'commercial', 'sign permit', 'demolition', 'septic', 'well',
  'zoning', 'variance', 'subdivision', 'environmental',
]

function isRoofingRelated(text) {
  const lower = (text || '').toLowerCase()
  const hasRoofing = ROOFING_KEYWORDS.some(function (k) {
    return lower.includes(k)
  })
  const hasSkip = SKIP_KEYWORDS.some(function (k) {
    return lower.includes(k)
  })
  return hasRoofing && !hasSkip
}

function isGeneralPermitForm(text) {
  const lower = (text || '').toLowerCase()
  return /permit application|notice of commencement|noc|owner builder|affidavit/i.test(lower)
}

async function findFormsPage(page, baseUrl) {
  const formsPatterns = [
    baseUrl + '/forms',
    baseUrl + '/documents',
    baseUrl + '/downloads',
    baseUrl + '/permits',
    baseUrl + '/building-forms',
    baseUrl + '/permit-applications',
    baseUrl + '/permit-forms',
    baseUrl + '/resources',
    baseUrl + '/forms-and-applications',
  ]

  const formsLink = await page.evaluate(function () {
    const links = Array.prototype.slice.call(document.querySelectorAll('a'))
    const found = links.find(function (a) {
      const text = (a.innerText || '').toLowerCase()
      const href = (a.href || '').toLowerCase()
      return (
        /\bforms\b|\bdocuments\b|\bdownloads\b|\bapplications\b|\bpermit forms\b/i.test(text + href) &&
        href.indexOf('mailto') === -1
      )
    })
    return found ? found.href : null
  })

  if (formsLink && formsLink !== page.url()) {
    return formsLink
  }

  for (const url of formsPatterns) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      if (response && response.status() === 200) {
        console.log('  Found forms page:', url)
        return url
      }
    } catch (e) {
      // continue
    }
  }
  return null
}

async function scrapeAHJForms(ahj, options) {
  const opts = options || {}
  const supabase = opts.supabase || createSupabase()
  const headless = opts.headless !== false

  console.log('\n========', ahj.county_or_city, 'County ========')
  console.log('URL:', ahj.portal_url)

  if (!ahj.portal_url) {
    console.log('  No portal_url — skipping')
    return []
  }

  const browser = await chromium.launch({ headless: headless })
  const page = await browser.newPage()
  const formsFound = []

  try {
    await page.goto(ahj.portal_url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2000)

    const formsPageUrl = await findFormsPage(page, ahj.portal_url)
    if (formsPageUrl && formsPageUrl !== ahj.portal_url) {
      await page.goto(formsPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(2000)
    }

    const allLinks = await page.evaluate(function () {
      return Array.prototype.slice
        .call(document.querySelectorAll('a'))
        .filter(function (a) {
          return a.href && a.href.length > 10
        })
        .map(function (a) {
          return {
            text: (a.innerText || a.textContent || a.title || '').replace(/\s+/g, ' ').trim(),
            href: a.href,
            title: (a.title || '').trim(),
            ariaLabel: (a.getAttribute('aria-label') || '').trim(),
          }
        })
        .filter(function (a) {
          return a.href && a.href.indexOf('mailto') !== 0 && a.href.indexOf('tel') !== 0
        })
    })

    console.log('  Total links:', allLinks.length)

    const roofingLinks = allLinks.filter(function (link) {
      const combined = link.text + ' ' + link.href + ' ' + link.title + ' ' + link.ariaLabel
      return (
        (isRoofingRelated(combined) || isGeneralPermitForm(combined)) &&
        (link.href.toLowerCase().indexOf('.pdf') !== -1 ||
          link.text.toLowerCase().indexOf('form') !== -1 ||
          link.text.toLowerCase().indexOf('affidavit') !== -1 ||
          link.text.toLowerCase().indexOf('application') !== -1 ||
          link.text.toLowerCase().indexOf('download') !== -1)
      )
    })

    console.log('  Roofing/permit forms found:', roofingLinks.length)
    roofingLinks.forEach(function (l) {
      console.log('   -', (l.text || '').slice(0, 60), '->', l.href.slice(0, 80))
    })

    for (const link of roofingLinks) {
      try {
        const response = await page.request.get(link.href, { timeout: 20000 })
        const contentType = response.headers()['content-type'] || ''
        if (response.status() === 200 && contentType.indexOf('pdf') !== -1) {
          const buffer = await response.body()
          const filename =
            (link.text || 'form')
              .replace(/[^a-z0-9\s]/gi, '')
              .replace(/\s+/g, '-')
              .toLowerCase()
              .slice(0, 60) + '.pdf'
          const countySlug = String(ahj.county_or_city || 'unknown')
            .toLowerCase()
            .replace(/[\s.]+/g, '-')
          const storagePath = 'ahj-forms/' + countySlug + '/' + filename

          const { error: uploadError } = await supabase.storage
            .from('job-documents')
            .upload(storagePath, buffer, {
              contentType: 'application/pdf',
              upsert: true,
            })

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('job-documents')
              .getPublicUrl(storagePath)
            formsFound.push({
              name: link.text || filename,
              originalUrl: link.href,
              storagePath: storagePath,
              publicUrl: urlData.publicUrl,
              sizeBytes: buffer.length,
            })
            console.log(
              '  ✓ Downloaded:',
              filename,
              '(' + Math.round(buffer.length / 1024) + 'KB)'
            )
          } else {
            console.error('  ✗ Upload failed:', filename, uploadError.message)
            formsFound.push({
              name: link.text || filename,
              originalUrl: link.href,
              storagePath: null,
              publicUrl: link.href,
              sizeBytes: 0,
              uploadFailed: true,
            })
          }
        } else if (response.status() === 200) {
          formsFound.push({
            name: link.text,
            originalUrl: link.href,
            storagePath: null,
            publicUrl: link.href,
            sizeBytes: 0,
            notPdf: true,
          })
          console.log('  ~ Non-PDF link saved:', (link.text || '').slice(0, 50))
        }
      } catch (err) {
        console.error('  ✗ Download failed:', (link.text || '').slice(0, 40), err.message)
      }
      await new Promise(function (r) {
        setTimeout(r, 500)
      })
    }
  } catch (err) {
    console.error('  Scrape failed:', err.message)
  } finally {
    await browser.close()
  }

  return formsFound
}

async function updateAHJRequirements(supabase, ahjId, countyName, forms) {
  let updated = 0
  let added = 0

  for (const form of forms) {
    const formNameLower = (form.name || '').toLowerCase()
    let matchedRequirementName = null

    if (/re.?roof affidavit|reroof affidavit/i.test(formNameLower)) {
      matchedRequirementName = 'Re-Roof Affidavit'
    } else if (/sheathing affidavit/i.test(formNameLower)) {
      matchedRequirementName = 'Sheathing Affidavit'
    } else if (/notice of commencement|noc/i.test(formNameLower)) {
      matchedRequirementName = 'Notice of Commencement (NOC)'
    } else if (/permit application|building permit application/i.test(formNameLower)) {
      matchedRequirementName = 'Permit Application'
    }

    if (matchedRequirementName) {
      const { data: existingRows } = await supabase
        .from('ahj_requirements')
        .select('id')
        .eq('ahj_id', ahjId)
        .eq('name', matchedRequirementName)

      if (existingRows && existingRows.length > 0) {
        const { error } = await supabase
          .from('ahj_requirements')
          .update({ download_url: form.publicUrl })
          .eq('ahj_id', ahjId)
          .eq('name', matchedRequirementName)
        if (!error) {
          console.log('  [db] Updated URL for:', matchedRequirementName)
          updated++
        }
      } else if (matchedRequirementName === 'Permit Application') {
        const { error } = await supabase.from('ahj_requirements').insert({
          ahj_id: ahjId,
          requirement_type: 'document',
          name: 'Permit Application',
          description: 'Building permit application form',
          is_required: true,
          sequence_order: 0,
          when_needed: 'at_permit',
          download_url: form.publicUrl,
          notes: 'Auto-discovered permit application form',
          is_active: true,
        })
        if (!error) {
          console.log('  [db] Added Permit Application')
          added++
        }
      }
    } else if (isRoofingRelated(form.name)) {
      const name = String(form.name || 'Form').slice(0, 100)
      const { data: existing } = await supabase
        .from('ahj_requirements')
        .select('id')
        .eq('ahj_id', ahjId)
        .eq('name', name)
        .maybeSingle()

      if (existing?.id) {
        const { error } = await supabase
          .from('ahj_requirements')
          .update({ download_url: form.publicUrl })
          .eq('id', existing.id)
        if (!error) {
          console.log('  [db] Updated existing requirement:', name.slice(0, 50))
          updated++
        }
      } else {
        const { error } = await supabase.from('ahj_requirements').insert({
          ahj_id: ahjId,
          requirement_type: 'document',
          name: name,
          description: 'Form found on ' + countyName + ' building department website',
          is_required: false,
          sequence_order: 10,
          when_needed: 'at_permit',
          download_url: form.publicUrl,
          notes: 'Auto-discovered — verify if required for roofing permits',
          is_active: true,
        })
        if (!error) {
          console.log('  [db] Added new requirement:', name.slice(0, 50))
          added++
        }
      }
    }
  }

  return { updated: updated, added: added }
}

async function logScrapeMetric(supabase, summary) {
  const today = new Date().toISOString().slice(0, 10)
  const row = {
    metric_name: SCRAPE_METRIC_NAME,
    metric_date: today,
    metric_value: summary.totalForms || 0,
    metadata: Object.assign({}, summary, { finishedAt: new Date().toISOString() }),
  }

  const { data: existing } = await supabase
    .from('platform_metrics')
    .select('id')
    .eq('metric_name', SCRAPE_METRIC_NAME)
    .eq('metric_date', today)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('platform_metrics')
      .update({ metric_value: row.metric_value, metadata: row.metadata })
      .eq('id', existing.id)
  } else {
    await supabase.from('platform_metrics').insert(row)
  }
}

async function getLastAhjFormsScrapeAt(supabase) {
  const { data } = await supabase
    .from('platform_metrics')
    .select('created_at, metadata, metric_date')
    .eq('metric_name', SCRAPE_METRIC_NAME)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  if (data.metadata?.finishedAt) return new Date(data.metadata.finishedAt)
  if (data.created_at) return new Date(data.created_at)
  if (data.metric_date) return new Date(data.metric_date + 'T00:00:00.000Z')
  return null
}

/**
 * Scrape all active FL AHJ building department sites for roofing forms.
 * @param {object} [options]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {boolean} [options.headless=true]
 * @param {boolean} [options.skipMetrics=false]
 * @param {string[]} [options.countyFilter] — optional county_or_city list
 */
async function scrapeAllAHJForms(options) {
  const opts = options || {}
  const supabase = opts.supabase || createSupabase()
  const headless = opts.headless !== false

  let query = supabase
    .from('ahj_portals')
    .select('id, name, county_or_city, portal_url')
    .eq('state', 'FL')
    .eq('is_active', true)
    .order('county_or_city')

  if (Array.isArray(opts.countyFilter) && opts.countyFilter.length > 0) {
    query = query.in('county_or_city', opts.countyFilter)
  }

  const { data: ahjs, error } = await query
  if (error) throw error

  console.log('Scraping', (ahjs || []).length, 'FL county building departments...')
  console.log('Looking for roofing permit forms and affidavits\n')

  const outDir = path.join(process.cwd(), 'tmp', 'ahj-forms-scrape')
  fs.mkdirSync(outDir, { recursive: true })

  const results = {}
  let totalForms = 0
  let totalUpdated = 0
  let totalAdded = 0
  let failed = 0
  const zeroForms = []
  const failedCounties = []

  for (const ahj of ahjs || []) {
    try {
      const forms = await scrapeAHJForms(ahj, { supabase: supabase, headless: headless })
      const { updated, added } = await updateAHJRequirements(
        supabase,
        ahj.id,
        ahj.county_or_city,
        forms
      )

      results[ahj.county_or_city] = {
        formsFound: forms.length,
        updated: updated,
        added: added,
        forms: forms.map(function (f) {
          return {
            name: f.name,
            url: f.publicUrl,
            sizeKB: Math.round((f.sizeBytes || 0) / 1024),
          }
        }),
      }

      totalForms += forms.length
      totalUpdated += updated
      totalAdded += added
      if (forms.length === 0) zeroForms.push(ahj.county_or_city)
      console.log('  Result:', forms.length, 'forms |', updated, 'updated |', added, 'added')
    } catch (err) {
      console.error('FAILED:', ahj.county_or_city, err.message)
      results[ahj.county_or_city] = { error: err.message }
      failed++
      failedCounties.push(ahj.county_or_city)
    }

    await new Promise(function (r) {
      setTimeout(r, 2000)
    })
  }

  const summary = {
    startedAt: opts.startedAt || new Date().toISOString(),
    countiesScraped: (ahjs || []).length - failed,
    countiesFailed: failed,
    totalForms: totalForms,
    totalUpdated: totalUpdated,
    totalAdded: totalAdded,
    zeroForms: zeroForms,
    failedCounties: failedCounties,
  }

  const resultsPath = path.join(outDir, 'scrape-results.json')
  fs.writeFileSync(
    resultsPath,
    JSON.stringify({ summary: summary, results: results }, null, 2)
  )

  if (!opts.skipMetrics) {
    try {
      await logScrapeMetric(supabase, summary)
    } catch (metricErr) {
      console.error('Failed to log scrape metric:', metricErr.message)
    }
  }

  console.log('\n========== FINAL SUMMARY ==========')
  console.log('Counties scraped:', summary.countiesScraped)
  console.log('Counties failed:', failed)
  console.log('Total forms found:', totalForms)
  console.log('Requirements updated with real URLs:', totalUpdated)
  console.log('New requirements added:', totalAdded)
  console.log('Zero-form counties:', zeroForms.length)
  console.log('Results saved to:', resultsPath)

  console.log('\nPer county:')
  Object.keys(results).forEach(function (county) {
    const data = results[county]
    if (data.error) {
      console.log('  ✗', county, ':', String(data.error).slice(0, 60))
    } else {
      console.log(
        '  ✓',
        county,
        ':',
        data.formsFound,
        'forms,',
        data.updated,
        'updated,',
        data.added,
        'added'
      )
    }
  })

  return Object.assign({}, summary, { results: results, resultsPath: resultsPath })
}

function createAhjFormsScrapeScheduler(supabase, options) {
  const opts = options || {}
  const intervalDays = opts.intervalDays || SCRAPE_INTERVAL_DAYS
  let running = false

  return {
    async maybeScrapeAhjForms() {
      if (running) {
        return { skipped: true, reason: 'already_running' }
      }

      const lastAt = await getLastAhjFormsScrapeAt(supabase)
      const daysSince = lastAt
        ? (Date.now() - lastAt.getTime()) / (1000 * 60 * 60 * 24)
        : 999

      if (daysSince < intervalDays) {
        return {
          skipped: true,
          reason: 'not_due',
          daysSince: Math.round(daysSince * 10) / 10,
          lastAt: lastAt ? lastAt.toISOString() : null,
        }
      }

      console.log(
        '[ops] Running monthly AHJ forms scrape (days since last: ' +
          Math.round(daysSince) +
          ')...'
      )
      running = true
      try {
        const result = await scrapeAllAHJForms({
          supabase: supabase,
          headless: true,
          startedAt: new Date().toISOString(),
        })
        return Object.assign({ skipped: false }, result)
      } finally {
        running = false
      }
    },
    getLastAhjFormsScrapeAt: function () {
      return getLastAhjFormsScrapeAt(supabase)
    },
  }
}

async function main() {
  return scrapeAllAHJForms({ startedAt: new Date().toISOString() })
}

module.exports = {
  scrapeAllAHJForms: scrapeAllAHJForms,
  scrapeAHJForms: scrapeAHJForms,
  createAhjFormsScrapeScheduler: createAhjFormsScrapeScheduler,
  getLastAhjFormsScrapeAt: getLastAhjFormsScrapeAt,
  SCRAPE_METRIC_NAME: SCRAPE_METRIC_NAME,
  main: main,
}

if (require.main === module) {
  main().catch(function (e) {
    console.error('Fatal:', e.message)
    process.exit(1)
  })
}
