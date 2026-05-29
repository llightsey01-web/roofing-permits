require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError, handleRunSuccess } = require('../shared/errors')
const config = require('./configs/polk-county.config')

async function runPolkCounty(jobData, runId) {
  console.log(`\nStarting Polk County automation`)
  console.log(`Job: ${jobData.owner_name} — ${jobData.property_address}`)
  console.log(`Run ID: ${runId}\n`)

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
    stepNumber++
    await logStep(page, runId, stepNumber, 'login', async () => {
      await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      const frameHandle = await page.$('iframe:not(.mask_iframe)')
      const frame = await frameHandle.contentFrame()
      await (await frame.waitForSelector(config.selectors.loginUsername)).fill(jobData.credentials.username)
      await (await frame.waitForSelector(config.selectors.loginPassword)).fill(jobData.credentials.password)

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

    stepNumber++
    await logStep(page, runId, stepNumber, 'navigate_to_disclaimer', async () => {
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    })

    stepNumber++
    await logStep(page, runId, stepNumber, 'accept_disclaimer', async () => {
      await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    stepNumber++
    await logStep(page, runId, stepNumber, 'select_reroof_permit', async () => {
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

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

    stepNumber++
    await logStep(page, runId, stepNumber, 'continue_to_permit_detail', async () => {
      await removeOverlay()
      await safeClick(config.selectors.continueBtn)
      await page.waitForTimeout(4000)

      const errors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ACA_Error, [class*="error"]'))
          .map(el => el.textContent.trim())
          .filter(t => t.length > 0 && t.length < 200)
      })
      if (errors.length > 0) {
        throw Object.assign(
          new Error(`Validation errors: ${errors.join(', ')}`),
          { errorCode: 'validation_failed' }
        )
      }

      await removeOverlay()
      await safeClick(config.selectors.continueBtn)
      await page.waitForTimeout(4000)
    })

    stepNumber++
    await logStep(page, runId, stepNumber, 'fill_permit_detail', async () => {
      await removeOverlay()
      await page.waitForTimeout(2000)
      console.log(`  URL: ${page.url()}`)

      // Wait for permit detail fields
      await page.waitForSelector(config.selectors.gateAccessNo, { timeout: 15000 })
        .catch(() => console.log('  Gate selector not found yet'))
      await page.waitForTimeout(1000)
      await removeOverlay()

      // Gate access
      if (jobData.job_specs && jobData.job_specs.gate_code) {
        await safeClick(config.selectors.gateAccessYes)
        await page.fill(config.selectors.gateCode, jobData.job_specs.gate_code)
      } else {
        await safeClick(config.selectors.gateAccessNo)
      }

      // Code violation — No
      await safeClick(config.selectors.codeViolationNo)

      // NOC — based on valuation
      const nocLabel = (jobData.valuation && jobData.valuation < 2500)
        ? 'NOC Exempt - Valuation Less Than $2,500'
        : 'Needed'
      await safeSelect(config.selectors.nocDropdown, nocLabel)

      // Packet submission
      await safeSelect(config.selectors.packetSubmission, 'Electronically')

      // FS 119 Status
      await safeSelect(config.selectors.fs119Status, 'Non-Exempt')

      // Private provider — No
      await safeClick(config.selectors.roofDeckNo)

      // Work type from scope
      const scope = (jobData.scope_of_work || '').toLowerCase()
      const workType = scope.includes('repair') ? 'Repair' : 'Replacement'
      await safeSelect(config.selectors.workType, workType)

      // Property type from job data
      await safeSelect(config.selectors.propertyType, jobData.property_type || 'Residential')

      // Reroof permit type
      await safeSelect(config.selectors.reroofPermitType, 'Reroof')

      // Number of squares
      if (jobData.roof_specs && jobData.roof_specs.squares) {
        await page.fill(config.selectors.numberOfSquares, String(jobData.roof_specs.squares))
      }

      // Roof type with partial match
      if (jobData.roof_type) {
        await page.selectOption(config.selectors.roofType, { label: jobData.roof_type })
          .catch(async () => {
            await page.evaluate((sel, rt) => {
              const el = document.querySelector(sel)
              if (el) {
                const opt = Array.from(el.options).find(o =>
                  o.text.toLowerCase().includes(rt.toLowerCase())
                )
                if (opt) el.value = opt.value
              }
            }, config.selectors.roofType, jobData.roof_type)
          })
      }

      // Cross street
      if (jobData.job_specs && jobData.job_specs.cross_street) {
        await page.fill(config.selectors.crossStreet, jobData.job_specs.cross_street)
      }

      await page.waitForTimeout(500)
    })

    stepNumber++
    await logStep(page, runId, stepNumber, 'check_required_boxes', async () => {
      await removeOverlay()
      await page.check(config.selectors.reroofAffidavit)
      await page.waitForTimeout(300)
      await page.check(config.selectors.asbestosStatement)
      await page.waitForTimeout(300)
    })

    stepNumber++
    await logStep(page, runId, stepNumber, 'stop_before_submit', async () => {
      console.log('\n========================================')
      console.log('AUTOMATION COMPLETE — AWAITING REVIEW')
      console.log('========================================\n')
      await page.waitForTimeout(2000)
    })

    await handleRunSuccess(runId, jobData.id, `${config.id}@v${config.version}`)

  } catch (err) {
    await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { runPolkCounty }