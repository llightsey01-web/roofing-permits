'use strict'

require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SCRAPE_METRIC_NAME = 'ahj_forms_scrape'
const SCRAPE_INTERVAL_DAYS = 30

const BUILDING_DEPT_URLS = {
  Alachua: 'https://growth-management.alachuacounty.us/building',
  Baker: 'https://www.bakercountyfl.org/departments/building-and-zoning',
  Bay: 'https://www.baycountyfl.gov/161/Building-Services',
  Bradford: 'https://www.bradfordcountyfl.gov/buildingzoning',
  Brevard: 'https://www.brevardfl.gov/BuildingPermitting',
  Calhoun: 'https://www.calhouncountyfl.gov/',
  Charlotte: 'https://www.charlottecountyfl.gov/departments/community-development/building-construction-services/',
  Citrus: 'https://www.citrusbocc.com/departments-services/building/',
  Clay: 'https://www.claycountygov.com/government/departments/building/',
  Collier: 'https://www.colliercountyfl.gov/government/growth-management/divisions/building-plan-review-inspections',
  Columbia: 'https://www.columbiacountyfla.com/BuildingandZoning.aspx',
  DeSoto: 'https://www.desotobocc.com/departments/development_services/building',
  Dixie: 'https://dixiecounty.org/',
  Duval: 'https://www.jacksonville.gov/departments/planning-and-development/building-inspection-division',
  Escambia: 'https://myescambia.com/our-services/development-services/building-inspections',
  Flagler: 'https://www.flaglercounty.gov/departments/building',
  Franklin: 'https://www.franklinfl.com/building-department',
  Gadsden: 'https://www.gadsdencountyfl.gov/departments/building_and_planning',
  Gilchrist: 'https://gilchrist.fl.us/building-and-zoning/',
  Glades: 'https://www.myglades.com/departments/community_development/building_department.php',
  Gulf: 'https://www.gulfcounty-fl.gov/building_department',
  Hamilton: 'https://www.hamiltoncountyfl.com/',
  Hardee: 'https://www.hardeecounty.net/departments/building/',
  Hendry: 'https://www.hendryfla.net/building.php',
  Hernando: 'https://www.hernandocounty.us/departments/public-works/building-division',
  Highlands: 'https://www.highlandsfl.gov/departments/building',
  Hillsborough: 'https://www.hillsboroughcounty.org/residents/property-owners-and-renters/building-services',
  Holmes: 'https://holmescountyfl.org/',
  'Indian River': 'https://ircgov.com/Building_Division/index.htm',
  Jackson: 'https://www.jacksoncountyfl.gov/departments/building_department/',
  Jefferson: 'https://www.jeffersoncountyfl.gov/',
  Lafayette: 'https://www.lafayettecountyfl.net/',
  Lake: 'https://www.lakecountyfl.gov/departments/building_services/',
  'Lee County': 'https://www.leegov.com/dcd/BldPermitServ',
  Leon: 'https://www.leoncountyfl.gov/departments/development-support-and-environmental-management/building-plans-review-and-inspection',
  Levy: 'https://www.levycounty.org/building.aspx',
  Liberty: 'https://www.libertycountyfl.org/',
  Madison: 'https://www.madisoncountyfl.com/',
  Manatee: 'https://www.mymanatee.org/departments/development_services/building_and_development_services',
  Marion: 'https://www.marionfl.org/agencies-departments/departments-a-n/building-safety',
  Martin: 'https://www.martin.fl.us/building',
  Monroe: 'https://www.monroecounty-fl.gov/149/Building-Department',
  Nassau: 'https://www.nassaucountyfl.com/149/Building-Department',
  Okaloosa: 'https://www.okaloosafl.gov/240/Building-Division',
  Okeechobee: 'https://www.okeechobeecountyfl.gov/departments/building',
  Orange: 'https://www.orangecountyfl.net/PermitsLicenses/BuildingPermits.aspx',
  Osceola: 'https://www.osceola.org/agencies-departments/community-development/building-services/',
  'Palm Beach': 'https://discover.pbcgov.org/pzb/building/Pages/default.aspx',
  Pasco: 'https://www.pascocountyfl.net/253/Building-Construction-Services',
  Pinellas: 'https://www.pinellas.gov/department/building-development-review-services/',
  'Polk County': 'https://www.polkfl.gov/services/building/permitting/',
  Putnam: 'https://www.putnam-fl.gov/243/Building-Zoning',
  'Santa Rosa': 'https://www.santarosa.fl.gov/165/Building-Inspections',
  Sarasota: 'https://www.scgov.net/government/planning-and-development-services/building',
  Seminole: 'https://www.seminolecountyfl.gov/departments-services/development-services/building/',
  'St. Johns': 'https://www.sjcfl.us/Building/',
  'St. Lucie': 'https://www.stlucieco.gov/departments-services/a-z/building-and-code-regulations',
  Sumter: 'https://www.sumtercountyfl.gov/149/Building-Services',
  Suwannee: 'https://suwanneecountyfl.gov/building-department/',
  Taylor: 'https://www.taylorcountygov.com/',
  Union: 'https://www.unioncounty-fl.gov/',
  Volusia: 'https://www.volusia.org/services/growth-and-resource-management/building-and-zoning/',
  Wakulla: 'https://www.mywakulla.com/departments/planning_and_community_development/building_department.php',
  Walton: 'https://www.co.walton.fl.us/149/Building-Department',
  Washington: 'https://www.washingtonfl.com/',
}

/** Known direct form PDFs when county sites hide links behind SharePoint/JS. */
const MANUAL_SEED_FORMS = {
  'Lee County': [
    { text: 'Roof Guide', href: 'https://www.leegov.com/dcd/PermittingDocs/Roof%20Guide.pdf' },
    { text: 'Roof Over Guide', href: 'https://www.leegov.com/dcd/PermittingDocs/Roof%20Over%20Guide.pdf' },
    {
      text: 'Residential Final Roofing Inspection Affidavit',
      href: 'https://www.leegov.com/dcd/Documents/BldPermitServ/Apps/RFRI_FORM_w_Photographs_Checklist.pdf',
    },
    {
      text: 'Notice of Commencement Form',
      href: 'https://www.leegov.com/dcd/Documents/BldPermitServ/Apps/NoticeofCommencement.pdf',
    },
  ],
}

function createSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/** Strict roofing-form filter (name/href must match these). */
function isRoofingForm(text) {
  return /roof|re.?roof|shingle|sheathing|affidavit|notice of commencement|\bnoc\b/i.test(
    text || ''
  )
}

async function findFormsNavLink(page) {
  return page.evaluate(function () {
    const links = Array.prototype.slice.call(
      document.querySelectorAll('a, nav a, .nav a, .menu a, li a')
    )
    const found = links.find(function (a) {
      const text = (a.innerText || a.textContent || '').toLowerCase().trim()
      const href = (a.href || '').toLowerCase()
      if (!a.href || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return false
      if (href.indexOf('javascript:') === 0) return false
      return (
        /^forms$/.test(text) ||
        /^documents$/.test(text) ||
        /^downloads$/.test(text) ||
        /^resources$/.test(text) ||
        /building forms|permit forms|forms\s*&\s*documents|forms and documents|forms\/documents|guides and forms|guides & forms|forms and applications|applications and forms/i.test(
          text
        ) ||
        /\/forms\b|\/documents\b|\/downloads\b|forms-documents|building-forms|permit-forms|guides/i.test(
          href
        )
      )
    })
    return found ? found.href : null
  })
}

async function collectPdfLinks(page) {
  return page.evaluate(function () {
    return Array.prototype.slice
      .call(document.querySelectorAll('a'))
      .filter(function (a) {
        if (!a.href) return false
        const href = a.href.toLowerCase()
        if (href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('javascript:') === 0) {
          return false
        }
        const text = (a.innerText || a.textContent || a.title || '').toLowerCase()
        const onclick = (a.getAttribute('onclick') || '').toLowerCase()
        const combined = text + ' ' + href
        const looksLikeFile =
          href.indexOf('.pdf') !== -1 ||
          text.indexOf('download') !== -1 ||
          onclick.indexOf('pdf') !== -1 ||
          /\/documents\/|\/forms\/|\/files\/|documentcenter|permittingdocs|blob\.core/i.test(href)
        const looksLikeRoofingForm =
          /roof|re.?roof|shingle|sheathing|affidavit|notice of commencement|\bnoc\b/i.test(combined)
        return looksLikeFile || looksLikeRoofingForm
      })
      .map(function (a) {
        return {
          text: (a.innerText || a.textContent || a.title || '').replace(/\s+/g, ' ').trim(),
          href: a.href,
        }
      })
  })
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
    // Step 1 — Navigate to building dept main website
    await page.goto(ahj.portal_url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2000)

    // Expand common accordion / details UI used by county form pages
    try {
      await page.evaluate(function () {
        document.querySelectorAll('details:not([open])').forEach(function (el) {
          el.open = true
        })
        document.querySelectorAll('[aria-expanded="false"]').forEach(function (el) {
          try {
            el.click()
          } catch (e) {}
        })
      })
      await page.waitForTimeout(800)
    } catch (e) {}

    // Step 2 — Find the forms/documents nav link
    const formsLink = await findFormsNavLink(page)
    const badFormsLink =
      !formsLink ||
      formsLink === page.url() ||
      /forms\.office\.com|PageNotFound|pagenotfound|404/i.test(formsLink)
    if (!badFormsLink) {
      console.log('  Forms tab:', formsLink)
      await page.goto(formsLink, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(2000)
      try {
        await page.evaluate(function () {
          document.querySelectorAll('details:not([open])').forEach(function (el) {
            el.open = true
          })
          document.querySelectorAll('[aria-expanded="false"]').forEach(function (el) {
            try {
              el.click()
            } catch (e) {}
          })
        })
        await page.waitForTimeout(800)
      } catch (e) {}
    } else {
      console.log('  No forms tab found — scanning current page')
    }

    // Step 3 — Find ALL PDF / download links on the forms page
    let allPdfLinks = await collectPdfLinks(page)

    // Merge known direct form PDFs for counties with JS/SharePoint barriers
    const manual = MANUAL_SEED_FORMS[ahj.county_or_city] || []
    if (manual.length) {
      console.log('  Adding', manual.length, 'manual seed form URLs')
      allPdfLinks = allPdfLinks.concat(manual)
    }
    console.log('  PDF/download links:', allPdfLinks.length)

    // Step 4 — Filter ONLY roofing related forms
    const roofingForms = allPdfLinks.filter(function (link) {
      const combined = (link.text + ' ' + link.href).toLowerCase()
      return isRoofingForm(combined)
    })

    console.log('  Roofing forms found:', roofingForms.length)
    roofingForms.forEach(function (l) {
      console.log('   -', (l.text || '').slice(0, 60), '->', l.href.slice(0, 80))
    })

    for (const link of roofingForms) {
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
            // Private bucket — expose via signed-URL proxy (public /object/public fails)
            const proxyUrl = '/api/contractor/ahj-forms?path=' + encodeURIComponent(storagePath)
            formsFound.push({
              name: link.text || filename,
              originalUrl: link.href,
              storagePath: storagePath,
              publicUrl: proxyUrl,
              storagePublicUrl: urlData.publicUrl,
              sizeBytes: buffer.length,
            })
            console.log(
              '  ✓ Downloaded:',
              filename,
              '(' + Math.round(buffer.length / 1024) + 'KB)'
            )
          } else {
            console.error('  ✗ Upload failed:', filename, uploadError.message)
            // Fall back to original county URL
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
          // Keep original URL when not a direct PDF response
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

    if (/re.?roof affidavit|reroof affidavit|existing roof retrofit|roof retrofit|roof affidavit/i.test(formNameLower)) {
      matchedRequirementName = 'Re-Roof Affidavit'
    } else if (/sheathing affidavit/i.test(formNameLower)) {
      matchedRequirementName = 'Sheathing Affidavit'
    } else if (/notice of commencement|\bnoc\b/i.test(formNameLower)) {
      matchedRequirementName = 'Notice of Commencement (NOC)'
    } else if (/roof inspection affidavit/i.test(formNameLower)) {
      matchedRequirementName = null // add as discovered roofing form below
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
      }
    } else if (isRoofingForm(form.name + ' ' + (form.publicUrl || ''))) {
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
 * Update ahj_portals.portal_url to main building department websites.
 */
async function updateBuildingDeptUrls(options) {
  const opts = options || {}
  const supabase = opts.supabase || createSupabase()
  let updated = 0
  const entries = Object.keys(BUILDING_DEPT_URLS)

  for (const county of entries) {
    const url = BUILDING_DEPT_URLS[county]
    const { data, error } = await supabase
      .from('ahj_portals')
      .update({ portal_url: url, updated_at: new Date().toISOString() })
      .eq('state', 'FL')
      .eq('county_or_city', county)
      .select('id, county_or_city, portal_url')

    if (error) {
      console.error('URL update failed:', county, error.message)
      continue
    }
    if (data && data.length) {
      updated += data.length
      console.log('  Updated', county, '->', url)
    } else {
      console.log('  No row for', county)
    }
  }

  console.log('Updated', updated, 'portal URLs')
  return { updated: updated }
}

/**
 * Scrape active FL AHJ building department sites for roofing forms.
 * @param {object} [options]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {boolean} [options.headless=true]
 * @param {boolean} [options.skipMetrics=false]
 * @param {string[]} [options.countyFilter]
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

  const resultsPath = path.join(
    outDir,
    opts.resultsFileName || 'scrape-results.json'
  )
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
  const args = process.argv.slice(2)
  if (args.indexOf('--update-urls') !== -1) {
    await updateBuildingDeptUrls()
    return
  }

  const zeroOnly = args.indexOf('--zero-only') !== -1
  const options = { startedAt: new Date().toISOString() }

  if (zeroOnly) {
    const resultsPath = path.join(process.cwd(), 'tmp', 'ahj-forms-scrape', 'scrape-results.json')
    let zeroForms = []
    try {
      const prev = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
      zeroForms = (prev.summary && prev.summary.zeroForms) || []
    } catch (e) {
      // fall through
    }
    if (!zeroForms.length) {
      // default from last known zero list
      zeroForms = Object.keys(BUILDING_DEPT_URLS).filter(function (c) {
        return true
      })
    }
    options.countyFilter = zeroForms
    options.resultsFileName = 'scrape-results-zero-retry.json'
    options.skipMetrics = false
    console.log('Re-scraping', zeroForms.length, 'zero-form counties only\n')
  }

  return scrapeAllAHJForms(options)
}

module.exports = {
  scrapeAllAHJForms: scrapeAllAHJForms,
  scrapeAHJForms: scrapeAHJForms,
  updateBuildingDeptUrls: updateBuildingDeptUrls,
  createAhjFormsScrapeScheduler: createAhjFormsScrapeScheduler,
  getLastAhjFormsScrapeAt: getLastAhjFormsScrapeAt,
  BUILDING_DEPT_URLS: BUILDING_DEPT_URLS,
  SCRAPE_METRIC_NAME: SCRAPE_METRIC_NAME,
  main: main,
}

if (require.main === module) {
  main().catch(function (e) {
    console.error('Fatal:', e.message)
    process.exit(1)
  })
}
