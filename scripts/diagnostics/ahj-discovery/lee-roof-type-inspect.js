/**
 * Lee County — read-only roofType / workType dropdown enum scrape.
 * Login → accept disclaimer → Re-Roof CapEdit → scrape <option> labels → exit.
 * NO submit / pay / save draft / delete.
 *
 * Required env vars: AHJ_DISCOVERY_COMPANY_ID, AHJ_DISCOVERY_AHJ_ID.
 * Usage: AHJ_DISCOVERY_COMPANY_ID=... AHJ_DISCOVERY_AHJ_ID=... \
 *   node scripts/diagnostics/ahj-discovery/lee-roof-type-inspect.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.local') })

const { chromium } = require('playwright')
const leeConfig = require('../../../automation/ahjs/configs/lee-county.config.js')
const { loginLeeAngularCommunityView } = require('../../../automation/ahjs/lee-county.runner.js')

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

const COMPANY_ID = requiredEnv('AHJ_DISCOVERY_COMPANY_ID')
const AHJ_ID = requiredEnv('AHJ_DISCOVERY_AHJ_ID')
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'tmp', 'lee-roof-type-inspect')
const POLK_EXPECTED = [
  'Built-up',
  'Composition or Wood Shingles',
  'Metal',
  'Tile',
  'TPO',
]

function ensureOut() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

async function getSelectOptions(page, selector) {
  if (!(await page.locator(selector).count())) {
    return { found: false, options: [] }
  }
  const options = await page.locator(selector + ' option').evaluateAll(function (opts) {
    return opts.map(function (o) {
      return { value: o.value, text: (o.text || '').trim() }
    }).filter(function (o) {
      return o.text && o.text !== '--Select--'
    })
  })
  return { found: true, options: options }
}

async function waitQuiet(page, ms) {
  await page.waitForTimeout(ms || 1500)
}

async function main() {
  ensureOut()
  const mod = await import('../../../lib/credentials/secure-credential-service.js')
  const credentials = await mod.getCredentials(COMPANY_ID, AHJ_ID)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const report = {
    generatedAt: new Date().toISOString(),
    ahj: 'Lee County',
    portalUrl: leeConfig.portalUrl,
    safety: { submitted: false, paid: false, draftSaved: false, disclaimerAccepted: true },
    selectors: {
      roofType: leeConfig.selectors.roofType,
      workType: leeConfig.selectors.workType,
    },
    polkExpected: POLK_EXPECTED,
  }

  try {
    await loginLeeAngularCommunityView(page, credentials, leeConfig)
    console.log('[lee-inspect] logged in →', page.url())

    await page.goto(leeConfig.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitQuiet(page, 2000)

    const disclaimerCb = leeConfig.selectors.disclaimerCheckbox
    await page.waitForSelector(disclaimerCb, { timeout: 20000 })
    await page.check(disclaimerCb)
    await page.screenshot({ path: path.join(OUT_DIR, '01-disclaimer-checked.png') })

    const continueSelectors = [
      leeConfig.selectors.continueBtn,
      '#ctl00_PlaceHolderMain_btnNextStep',
      '#ctl00_PlaceHolderMain_actionBarBottom_btnContinue',
      'input[value*="Continue"]',
      'a:has-text("Continue Application")',
    ].join(', ')

    await Promise.all([
      page.waitForURL('**/CapType.aspx**', { timeout: 60000 }).catch(function () {}),
      page.click(continueSelectors, { timeout: 60000 }),
    ])
    await waitQuiet(page, 3000)
    if (!/CapType\.aspx/i.test(page.url())) {
      await page.screenshot({ path: path.join(OUT_DIR, 'error-after-disclaimer.png'), fullPage: true })
      throw new Error('Did not reach CapType after disclaimer (url=' + page.url() + ')')
    }
    console.log('[lee-inspect] disclaimer accepted → CapType')

    await page.click(leeConfig.selectors.permitTypeReRoof)
    await Promise.all([
      page.waitForURL('**/CapEdit.aspx**', { timeout: 60000 }).catch(function () {}),
      page.click(continueSelectors, { timeout: 60000 }),
    ])
    await waitQuiet(page, 3000)
    console.log('[lee-inspect] CapEdit →', page.url())

    // Permit Information custom fields may be on page 2 — advance if roofType not visible
    for (var step = 0; step < 4; step++) {
      if (await page.locator(leeConfig.selectors.roofType).count()) break
      const continueBtn = page.locator('#ctl00_PlaceHolderMain_actionBarBottom_btnContinue, #ctl00_PlaceHolderMain_btnNextStep')
      if (!(await continueBtn.count())) break
      // Only continue through location pages — stop if we'd leave CapEdit
      const urlBefore = page.url()
      await continueBtn.first().click({ timeout: 10000 }).catch(function () {})
      await waitQuiet(page, 2500)
      if (!/CapEdit\.aspx/i.test(page.url())) {
        console.log('[lee-inspect] left CapEdit unexpectedly — stopping navigation')
        break
      }
      if (page.url() === urlBefore) await waitQuiet(page, 2000)
    }

    await page.screenshot({ path: path.join(OUT_DIR, 'capedit-fields.png'), fullPage: true })

    report.roofType = await getSelectOptions(page, leeConfig.selectors.roofType)
    report.workType = await getSelectOptions(page, leeConfig.selectors.workType)

    if (!report.roofType.found) {
      // Fallback: any select whose options match known roof labels
      report.roofTypeFallback = await page.evaluate(function () {
        var hits = []
        document.querySelectorAll('select').forEach(function (sel) {
          var texts = Array.from(sel.options).map(function (o) { return (o.text || '').trim() })
          if (texts.some(function (t) { return /Composition or Wood|Built-up|TPO/i.test(t) })) {
            hits.push({
              id: sel.id,
              options: texts.filter(function (t) { return t && t !== '--Select--' }),
            })
          }
        })
        return hits
      })
    }

    const leeRoofLabels = report.roofType.found
      ? report.roofType.options.map(function (o) { return o.text })
      : (report.roofTypeFallback && report.roofTypeFallback[0] ? report.roofTypeFallback[0].options : [])

    report.leeRoofLabels = leeRoofLabels
    report.matchesPolkExactly =
      leeRoofLabels.length === POLK_EXPECTED.length &&
      POLK_EXPECTED.every(function (v, i) { return leeRoofLabels[i] === v })

    report.matchesPolkSet =
      POLK_EXPECTED.length === leeRoofLabels.length &&
      POLK_EXPECTED.every(function (v) { return leeRoofLabels.indexOf(v) !== -1 })

    fs.writeFileSync(path.join(OUT_DIR, 'lee-roof-type-inspect.json'), JSON.stringify(report, null, 2))
    console.log('[lee-inspect] roofType options:', JSON.stringify(leeRoofLabels))
    console.log('[lee-inspect] workType options:', JSON.stringify(
      report.workType.found ? report.workType.options.map(function (o) { return o.text }) : []
    ))
    console.log('[lee-inspect] matchesPolkExactly:', report.matchesPolkExactly)
    console.log('[lee-inspect] matchesPolkSet:', report.matchesPolkSet)
    console.log('[lee-inspect] report → tmp/lee-roof-type-inspect/lee-roof-type-inspect.json')

    if (!report.matchesPolkSet) {
      process.exitCode = 2
    }
  } finally {
    await browser.close()
  }
}

main().catch(function (err) {
  console.error('[lee-inspect] FAILED:', err.message)
  process.exit(1)
})
