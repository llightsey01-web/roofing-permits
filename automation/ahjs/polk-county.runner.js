require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { Solver } = require('2captcha')
const { logStep } = require('../shared/screenshot')
const { handleRunError } = require('../shared/errors')
const config = require('./configs/polk-county.config')
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
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
      new Error('No credentials found for this company and AHJ'),
      { errorCode: 'missing_credentials' }
    )
  }
  return { username: data.username, password: data.portal_password }
}

var suffixMap = {
  'circle': 'Cir', 'cir': 'Cir',
  'street': 'St', 'st': 'St',
  'avenue': 'Ave', 'ave': 'Ave',
  'drive': 'Dr', 'dr': 'Dr',
  'boulevard': 'Blvd', 'blvd': 'Blvd',
  'lane': 'Ln', 'ln': 'Ln',
  'road': 'Rd', 'rd': 'Rd',
  'court': 'Ct', 'ct': 'Ct',
  'place': 'Pl', 'pl': 'Pl',
  'way': 'Way', 'trail': 'Trl', 'trl': 'Trl',
  'terrace': 'Ter', 'ter': 'Ter', 'loop': 'Loop'
}

function parseAddress(fullAddress) {
  var parts = fullAddress.trim().split(' ')
  var streetNo = parts[0]
  var lastWord = parts[parts.length - 1].toLowerCase()
  var normalizedSuffix = suffixMap[lastWord] || null
  var streetName = normalizedSuffix ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ')
  return { streetNo: streetNo, streetName: streetName, suffix: normalizedSuffix }
}

async function runPolkCounty(jobData, runId) {
  console.log('\nStarting Polk County automation')
  console.log('Job: ' + jobData.owner_name + ' — ' + jobData.property_address)
  console.log('Run ID: ' + runId + '\n')

  const failures = []
  for (const check of config.preflightChecks) {
    if (check.field && !jobData[check.field]) failures.push(check.message)
    if (check.docType) {
      const found = jobData.documents && jobData.documents.some(function(d) {
        return d.document_type === check.docType
      })
      if (!found) failures.push(check.message)
    }
  }
  if (failures.length > 0) {
    failures.forEach(function(f) { console.log('  — ' + f) })
    throw Object.assign(new Error('Preflight failed'), { errorCode: 'missing_document', failures: failures })
  }
  console.log('✓ Preflight passed\n')

  console.log('Loading AHJ credentials...')
  const credentials = await getCredentials(jobData.company_id, jobData.ahj_id)
  console.log('✓ Credentials loaded for: ' + credentials.username + '\n')

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
    await page.evaluate(function() {
      var mask = document.getElementById('dvACADialogLayerMask')
      if (mask) mask.remove()
      document.querySelectorAll('.mask_iframe, iframe.mask_iframe').forEach(function(el) { el.remove() })
      document.querySelectorAll('[id*="Mask"], [class*="mask"]').forEach(function(el) {
        el.style.display = 'none'
        el.style.pointerEvents = 'none'
      })
    })
    await page.waitForTimeout(500)
  }

  async function safeClick(selector) {
    await removeOverlay()
    await page.evaluate(function(sel) {
      var el = document.querySelector(sel)
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }, selector)
    await page.waitForTimeout(300)
  }

  async function safeSelect(selector, label) {
    await page.selectOption(selector, { label: label }).catch(async function() {
      await page.evaluate(function(sel) {
        var el = document.querySelector(sel)
        if (el && el.options.length > 1) el.selectedIndex = 1
      }, selector)
    })
    await page.waitForTimeout(300)
  }

  async function saveStep6FailureArtifacts(runId) {
    var dir = path.join('automation', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    var base = path.join(dir, 'step6-failure-' + runId + '-' + Date.now())
    await page.screenshot({ path: base + '.png', fullPage: true })
    fs.writeFileSync(base + '.html', await page.content())
    console.log('[results] failure artifacts saved: ' + base)
  }

  try {
    // Step 1 — Login
    stepNumber++
    await logStep(page, runId, stepNumber, 'login', async function() {
      await page.goto(config.portalUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      var frameHandle = await page.$('iframe:not(.mask_iframe)')
      var frame = await frameHandle.contentFrame()
      await (await frame.waitForSelector(config.selectors.loginUsername)).fill(credentials.username)
      await (await frame.waitForSelector(config.selectors.loginPassword)).fill(credentials.password)
      var result = await solver.recaptcha(config.selectors.loginSiteKey, config.portalUrl)
      await frame.evaluate(function(token) {
        document.querySelectorAll('[id="g-recaptcha-response"]').forEach(function(el) {
          el.style.display = 'block'
          el.value = token
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        })
        var tryCallback = function(obj, token, depth) {
          depth = depth || 0
          if (depth > 5 || !obj) return
          try {
            if (typeof obj === 'object') {
              Object.keys(obj).forEach(function(key) {
                if (key === 'callback' && typeof obj[key] === 'function') obj[key](token)
                else tryCallback(obj[key], token, depth + 1)
              })
            }
          } catch(e) {}
        }
        if (window.___grecaptcha_cfg) tryCallback(window.___grecaptcha_cfg, token)
      }, result.data)
      await page.waitForTimeout(1500)
      await frame.evaluate(function() {
        document.querySelectorAll('button').forEach(function(b) {
          if (b.textContent.includes('Sign In')) b.click()
        })
      })
      await page.waitForURL('**/Dashboard.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 2 — Navigate to disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'navigate_to_disclaimer', async function() {
      await page.goto(config.selectors.disclaimerUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    })

    // Step 3 — Accept disclaimer
    stepNumber++
    await logStep(page, runId, stepNumber, 'accept_disclaimer', async function() {
      await (await page.waitForSelector(config.selectors.disclaimerCheckbox)).check()
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 4 — Select Re-Roof permit type
    stepNumber++
    await logStep(page, runId, stepNumber, 'select_reroof_permit', async function() {
      await page.click(config.selectors.permitTypeReRoof)
      await page.waitForTimeout(500)
      await page.click('text=Continue Application')
      await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
      await page.waitForTimeout(2000)
    })

    // Step 5 — Fill address search with parsed components
    stepNumber++
    await logStep(page, runId, stepNumber, 'fill_address_search', async function() {
      var parsed = parseAddress(jobData.property_address)
      console.log('  Street number: ' + parsed.streetNo)
      console.log('  Street name: ' + parsed.streetName)
      console.log('  Suffix: ' + (parsed.suffix || 'none'))

      await page.fill(config.selectors.streetNo, parsed.streetNo)
      await page.waitForTimeout(200)
      await page.fill(config.selectors.streetName, parsed.streetName)
      await page.waitForTimeout(200)

      if (parsed.suffix && config.selectors.streetType) {
        await page.selectOption(config.selectors.streetType, { label: parsed.suffix })
          .catch(async function() {
            await page.evaluate(function(args) {
              var el = document.querySelector(args.sel)
              if (el) {
                var opt = Array.from(el.options).find(function(o) {
                  return o.text.toLowerCase().includes(args.suffix.toLowerCase())
                })
                if (opt) el.value = opt.value
              }
            }, { sel: config.selectors.streetType, suffix: parsed.suffix })
          })
        console.log('  Suffix filled: ' + parsed.suffix)
      }

      await page.waitForTimeout(500)
      await page.click(config.selectors.addressSearchBtn)

      var searchWaitStart = Date.now()
      var searchWaitReason = 'timeout'
      var sawLoadingOrModal = false
      console.log('  Waiting up to 15s for portal response after search...')

      while (Date.now() - searchWaitStart < 15000) {
        var searchState = await page.evaluate(function(sels) {
          var parcelEl = document.querySelector(sels.parcelNo)
          var cityEl = document.querySelector(sels.city)
          var zipEl = document.querySelector(sels.zip)
          var parcelVal = parcelEl ? (parcelEl.value || '').trim() : ''
          var cityVal = cityEl ? (cityEl.value || '').trim() : ''
          var zipVal = zipEl ? (zipEl.value || '').trim() : ''

          var loading = document.getElementById('divLoadingTemplate')
          var loadingVisible = false
          if (loading) {
            var loadingStyle = window.getComputedStyle(loading)
            loadingVisible = loadingStyle.display !== 'none' &&
              loadingStyle.visibility !== 'hidden' &&
              loading.offsetParent !== null
          }

          var dialog = document.getElementById('dvACADialogLayer')
          var mask = document.getElementById('dvACADialogLayerMask')
          var modalVisible = false
          if (dialog) {
            var dialogStyle = window.getComputedStyle(dialog)
            modalVisible = dialogStyle.display !== 'none' &&
              !dialog.classList.contains('ACA_Hide') &&
              dialog.offsetHeight > 20
          }
          if (mask && mask.offsetParent !== null) modalVisible = true

          return {
            parcelVal: parcelVal,
            cityVal: cityVal,
            zipVal: zipVal,
            loadingVisible: loadingVisible,
            modalVisible: modalVisible
          }
        }, {
          parcelNo: config.selectors.parcelNo,
          city: config.selectors.city,
          zip: config.selectors.zip
        }).catch(function() { return {} })

        if (searchState.parcelVal) {
          searchWaitReason = 'parcel populated'
          break
        }
        if (searchState.cityVal && searchState.zipVal) {
          searchWaitReason = 'city and zip populated'
          break
        }
        if (searchState.loadingVisible || searchState.modalVisible) {
          sawLoadingOrModal = true
        }
        if (sawLoadingOrModal && !searchState.loadingVisible && !searchState.modalVisible) {
          searchWaitReason = 'loading spinner and modal disappeared'
          break
        }

        await page.waitForTimeout(500)
      }

      var searchWaitMs = Date.now() - searchWaitStart
      console.log('  Wait finished in ' + searchWaitMs + 'ms — condition: ' + searchWaitReason)
    })

    // Step 6 — Select address result
    stepNumber++
    await logStep(page, runId, stepNumber, 'select_address_result', async function() {
      await removeOverlay()

      var parcelNumber = await page.$eval(
        config.selectors.parcelNo,
        function(el) { return (el.value || '').trim() }
      ).catch(function() { return '' })
      var city = await page.$eval(
        config.selectors.city,
        function(el) { return (el.value || '').trim() }
      ).catch(function() { return '' })
      var zip = await page.$eval(
        config.selectors.zip,
        function(el) { return (el.value || '').trim() }
      ).catch(function() { return '' })

      var autoFilled = !!(parcelNumber || (city && zip))
      console.log('[results] auto-fill detected: ' + autoFilled)
      if (autoFilled) {
        console.log('[results] parcel: ' + (parcelNumber || 'n/a') + ', city: ' + city + ', zip: ' + zip)
        console.log('  Address selected — portal populating fields...')
        return
      }

      var rowSelector = config.selectors.addressResult
      console.log('[results] auto-fill not detected — attempting grid selection')
      console.log('[results] selector used: ' + rowSelector)

      try {
        await page.waitForSelector(rowSelector, { timeout: 10000 })
      } catch (waitErr) {
        await saveStep6FailureArtifacts(runId)
        throw Object.assign(
          new Error('Address results grid did not appear: ' + jobData.property_address),
          { errorCode: 'validation_failed' }
        )
      }

      var rawRows = await page.$$eval(rowSelector, function(rows) {
        return rows.map(function(row) { return row.innerText.trim() })
      }).catch(function() { return [] })
      rawRows.forEach(function(text, i) {
        console.log('[results] raw row text [' + i + ']: "' + text + '"')
      })

      var matchedRows = await page.$$eval(rowSelector, function(rows) {
        return rows.map(function(row, i) {
          return { index: i, text: row.innerText.trim() }
        }).filter(function(r) {
          if (!r.text) return false
          if (/continue application/i.test(r.text)) return false
          return /^\d+/.test(r.text)
        })
      }).catch(function() { return [] })

      if (matchedRows.length === 0) {
        await saveStep6FailureArtifacts(runId)
        throw Object.assign(
          new Error('Address not found in portal: ' + jobData.property_address),
          { errorCode: 'validation_failed' }
        )
      }

      var matched = matchedRows[0]
      console.log('[results] matched row [' + matched.index + ']: "' + matched.text + '"')

      var resultRows = await page.$$(rowSelector)
      var targetRow = resultRows[matched.index]
      await targetRow.evaluate(function(row) {
        var link = row.querySelector('a')
        var target = link || row
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })

      console.log('[results] clicked row [' + matched.index + ']: "' + matched.text + '"')

      await page.waitForTimeout(5000)
      await removeOverlay()
      console.log('  Address selected — portal populating fields...')
    })

    // Step 7 — Phase 1 stop point
    stepNumber++
    await logStep(page, runId, stepNumber, 'phase1_save_parcel_and_stop', async function() {
      var supabase = getSupabase()
      await page.waitForTimeout(2000)

      var allInputs = await page.$$eval('input[type="text"], input:not([type])', function(els) {
        return els.map(function(el) {
          return { id: el.id, name: el.name, value: el.value }
        }).filter(function(el) { return el.value && el.value.trim().length > 0 })
      }).catch(function() { return [] })
      console.log('  Populated fields (' + allInputs.length + '):')
      allInputs.forEach(function(el) {
        console.log('    #' + el.id + ' value="' + el.value + '"')
      })

      var parcelNumber = await page.$eval(
        config.selectors.parcelNo,
        function(el) { return el.value || el.innerText || '' }
      ).catch(function() { return '' })

      var portalOwnerName = await page.$eval(
        config.selectors.ownerName,
        function(el) { return el.value || el.innerText || '' }
      ).catch(function() { return '' })

      console.log('  Parcel raw value: "' + parcelNumber + '"')
      console.log('  Owner raw value: "' + portalOwnerName + '"')

      if (!parcelNumber || parcelNumber.trim() === '') {
        console.log('  Parcel not found — marking needs_review')
        await supabase.from('automation_runs').update({
          run_status: 'needs_review',
          error_message: 'Parcel number not populated. Check address format and dropdown selection.',
          completed_at: new Date().toISOString(),
        }).eq('id', runId)
        await supabase.from('jobs').update({ job_status: 'needs_review' }).eq('id', jobData.id)
        return
      }

      var updateData = { parcel_number: parcelNumber.trim() }
      if (portalOwnerName && !jobData.owner_name) {
        updateData.owner_name = portalOwnerName.trim()
      }
      await supabase.from('jobs').update(updateData).eq('id', jobData.id)
      console.log('  ✓ Parcel saved: ' + parcelNumber)

      await removeOverlay()
      await page.waitForSelector('a[onclick*="doSaveAndResume"]', { timeout: 10000 })
      await page.click('a[onclick*="doSaveAndResume"]')
      await page.waitForTimeout(3000)
      console.log('  ✓ Application saved in portal')

      await supabase.from('automation_runs').update({
        run_status: 'waiting_for_noc',
        completed_at: new Date().toISOString(),
      }).eq('id', runId)
      await supabase.from('jobs').update({ job_status: 'waiting_for_noc' }).eq('id', jobData.id)
      console.log('  ✓ Status: waiting_for_noc')

      var webAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://roofing-permits-production.up.railway.app'
      fetch(webAppUrl + '/api/noc/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobData.id }),
      }).then(function(r) { return r.json() })
        .then(function(result) { console.log('  ✓ NOC pipeline triggered') })
        .catch(function(err) { console.error('  NOC trigger failed: ' + err.message) })
    })

    console.log('\n========================================')
    console.log('PHASE 1 COMPLETE — NOC PIPELINE STARTED')
    console.log('========================================\n')

  } catch (err) {
    await handleRunError(runId, jobData.id, err)
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { runPolkCounty }