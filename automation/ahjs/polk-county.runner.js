require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError, handleRunSuccess } = require('../shared/errors')
const config = require('./configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function getCredentials(companyId, ahjId) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    throw Object.assign(
      new Error('No credentials found for this company and AHJ. Please add credentials in the admin panel.'),
      { errorCode: 'missing_credentials' }
    )
  }
  return { username: data.username, password: data.portal_password }
}

async function runPolkCounty(jobData, runId) {
  console.log(`\nStarting Polk County automation`)
  console.log(`Job: ${jobData.owner_name} — ${jobData.property_address}`)
  console.log(`Run ID: ${runId}\n`)

  // Preflight checks
  const failures = []
  for (const check of config.preflightChecks) {
    if (check.field && !jobData[check.field]) failures.push(check.message)
    if (check.docType) {
      const found = jobData.documents?.some(d => d.document_type === check.docType)
      if (!found) failures.push(check.message)
    }
  }
  if (failures.length > 0) {
    failures.forEach(f => console.log(`  — ${f}`))
    throw Object.assign(new Error('Preflight failed'), { errorCode: 'missing_document', failures })
  }
  console.log('✓ Preflight passed\n')

  // Load credentials from DB
  console.log('Loading AHJ credentials...')
  const credentials = await getCredentials(jobData.company_id, jobData.ahj_id)
  console.log(`✓ Credentials loaded for: ${credentials.username}\n`)

  // Portal availability check
  console.log('Checking portal availability...')
  try {
    const res = await fetch(config.portalUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    if (res.status === 502 || res.status === 503) {
      throw Object.assign(new Error('Portal is down'), { errorCode: 'portal_down' })
    }
    console.log('✓ Portal is reachable\n')
  } catch (err) {
    if (err.errorCode === 'portal_down') throw err
    console.log('Portal check inconclusive — proceeding anyway')
  }

  const solver = new Solver(process.env.TWOCAPTCHA_API_KEY)
  const browser = await chromium.launch({ headless: true, slowMo: 300 })
  const page = await browser.newPage()
  page.setDefaultTimeout(45000)
  let stepNumber = 0

  async function removeOverlay() {
    await page.evaluate(() => {
      const mask = document.getElementById('dvACADialogLayerMask')
      if (mask) mask.remove()
      document.querySelectorAll('.mask_iframe, iframe.mask_iframe').forEach(el => el.remove())
      document.querySelectorAll('[id*="Mask"], [class*="mask"]').forEach(el => {
        el.style.display = 'none'
        el.style.pointerEvents = 'none'
      })
    })
    await page.waitForTimeout(500)
  }

  async function safeClick(selector) {
    await removeOverlay()
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, selector)
    await page.waitForTimeout(300)
  }

  async function safeSelect(selector, label) {
    await page.selectOption(selector, { label }).catch(async () => {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el && el.options.length > 1) el.selectedIndex = 1
      }, selector)
    })
    await page.waitForTimeout(300)
  }

  try {
    // Step 1 — Login
    stepNumber++
    await logStep(page, runId, stepNumber, 'login', async () => {
      await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      const frameHandle = await page.$('iframe:not(.mask_iframe)')
      const frame = await frameHandle.contentFrame()
      await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
      await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
      const result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
      await frame.evaluate((token) => {
        document.querySelectorAll('[id="g-recaptcha-response"]').forEach(el => {
          el.style.display = 'block'
          el.value = token
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        })
        const tryCallback = (obj, token, depth = 0) => {
          if (depth > 5 || !obj) return
          try {
            if (typeof obj === 'object') {
              for (const key of Object.keys(obj)) {
                if (key === 'callback' && typeof obj[key] === 'function') obj[key](token)
                else tryCallback(obj[key], token, depth + 1)
              }
            }
          } catch(e) {}
        }
        if (window.___grecaptcha_cfg) tryCallback(window.___grecaptcha_cfg, token)
      }, result.data)
      await page.waitForTimeout(1500)
      await frame.evaluate(() => {
        document.querySelectorAll('button').forEach(b => {
          if (b.textContent.includes('Sign In')) b.click()
        })
      })
      await page.waitForURL('**/Dashboard.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 2 — Navigate to disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'navigate_to_disclaimer', async () => {
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    })

    // Step 3 — Accept disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'accept_disclaimer', async () => {
      await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 4 — Select Re-Roof permit type
    stepNumber++
    await logStep(page, runId, stepNumber, 'select_reroof_permit', async () => {
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 5 — Fill address search
    stepNumber++
    await logStep(page, runId, stepNumber, 'fill_address_search', async () => {
      const addressParts = jobData.property_address.trim().split(' ')
      const streetNo = addressParts[0]
      const streetName = addressParts.slice(1).join(' ')
      await page.fill(config.selectors.streetNo, streetNo)
      await page.fill(config.selectors.streetName, streetName)
      await page.waitForTimeout(500)
      await page.click(config.selectors.addressSearchBtn)
      await page.waitForTimeout(4000)
    })

    // Step 6 — Select address result
    // Portal auto-fills parcel number and owner name after this step
    stepNumber++
    await logStep(page, runId, stepNumber, 'select_address_result', async () => {
      await removeOverlay()
      await page.waitForTimeout(500)
      const resultEl = await page.$(config.selectors.addressResult)
      if (!resultEl) {
        throw Object.assign(
          new Error(`Address not found: ${jobData.property_address}`),
          { errorCode: 'validation_failed' }
        )
      }
      await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }, config.selectors.addressResult)
      await page.waitForTimeout(3000)
      await removeOverlay()
    })

    // Step 7 — PHASE 1 STOP POINT
    // Read parcel + owner from portal, save to DB, click Save & Resume Later, trigger NOC
    stepNumber++
    await logStep(page, runId, stepNumber, 'phase1_save_parcel_and_stop', async () => {
      const supabase = getSupabase()

      // Read parcel number auto-filled by portal
      const parcelNumber = await page.$eval(
        config.selectors.parcelNo,
        el => el.value || el.innerText || ''
      ).catch(() => '')

      // Read owner name auto-filled by portal
      const portalOwnerName = await page.$eval(
        config.selectors.ownerName,
        el => el.value || el.innerText || ''
      ).catch(() => '')

      console.log(`  Parcel number: ${parcelNumber}`)
      console.log(`  Owner name from portal: ${portalOwnerName}`)

      // Save parcel number and owner to job record
      const updateData = { parcel_number: parcelNumber || null }
      if (portalOwnerName && !jobData.owner_name) {
        updateData.owner_name = portalOwnerName
      }

      await supabase.from('jobs')
        .update(updateData)
        .eq('id', jobData.id)

      console.log('  ✓ Parcel number saved to job record')

      // Click Save and Resume Later
      await removeOverlay()
      await page.waitForSelector('a[onclick*="doSaveAndResume"]', { timeout: 10000 })
      await page.click('a[onclick*="doSaveAndResume"]')
      await page.waitForTimeout(3000)
      console.log('  ✓ Application saved in portal — can be resumed after NOC is recorded')

      // Update automation run status
      await supabase.from('automation_runs')
        .update({
          run_status: 'waiting_for_noc',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)

      // Update job status
      await supabase.from('jobs')
        .update({ job_status: 'waiting_for_noc' })
        .eq('id', jobData.id)

      console.log('  ✓ Job status updated to waiting_for_noc')

      // Trigger NOC pipeline
      console.log('  Starting NOC pipeline...')
      try {
        const { startNOCPipeline } = require('../../lib/noc/noc-pipeline.js')
        startNOCPipeline(jobData.id)
          .then(() => console.log('  ✓ NOC pipeline started'))
          .catch(err => console.error('  NOC pipeline error:', err.message))
      } catch (err) {
        console.error('  Failed to start NOC pipeline:', err.message)
      }
    })

    console.log('\n========================================')
    console.log('PHASE 1 COMPLETE — NOC PIPELINE STARTED')
    console.log('Resume automation after NOC is recorded')
    console.log('========================================\n')

  } catch (err) {
    await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { runPolkCounty }