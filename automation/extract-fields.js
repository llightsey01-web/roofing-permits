require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { Solver } = require('2captcha')

async function run() {
  console.log('Extracting Permit Detail fields...\n')

  const solver = new Solver(process.env.TWOCAPTCHA_API_KEY)
  const browser = await chromium.launch({ headless: false, slowMo: 600 })

  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(45000)

    console.log('Logging in...')
    await page.goto('https://aca-prod.accela.com/POLKCO/Login.aspx', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    const frameHandle = await page.$('iframe')
    const frame = await frameHandle.contentFrame()
    await (await frame.waitForSelector('[name="username"]')).fill(process.env.POLK_COUNTY_USERNAME)
    await (await frame.waitForSelector('[name="password"]')).fill(process.env.POLK_COUNTY_PASSWORD)

    console.log('Solving CAPTCHA...')
    const result = await solver.recaptcha(
      '6LcsG08UAAAAANjzx4qNeHD3__8lwLWcwfnrpWln',
      'https://aca-prod.accela.com/POLKCO/Login.aspx'
    )

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
    console.log('✓ Logged in')

    // Disclaimer
    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/CapApplyDisclaimer.aspx?module=Building', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await (await page.waitForSelector('input[type="checkbox"]')).check()
    await page.waitForTimeout(500)
    await page.click('text=Continue Application')
    await page.waitForURL('**/CapType.aspx**', { timeout: 15000 })
    await page.waitForTimeout(2000)

    // Select Re-Roof
    await page.click('text=Re-Roof Permit')
    await page.waitForTimeout(500)
    await page.click('text=Continue Application')
    await page.waitForURL('**/CapEdit.aspx**', { timeout: 15000 })
    await page.waitForTimeout(2000)
    console.log('✓ On Step 1 — Location & People')

    // Fill only street number and name — let search autofill everything else
    await page.fill('#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetNo', '603')
    await page.fill('#ctl00_PlaceHolderMain_WorkLocationEdit_txtStreetName', 'CLAYTON')
    await page.waitForTimeout(500)
    console.log('✓ Street number and name filled')

    // Click address Search
    await page.click('#ctl00_PlaceHolderMain_WorkLocationEdit_btnSearch')
    await page.waitForTimeout(3000)
    console.log('✓ Search clicked')

    // Select first result
    const resultEl = await page.$('.ACA_Grid_Row a')
    if (resultEl) {
      await resultEl.click()
      await page.waitForTimeout(2000)
      console.log('✓ Address selected — fields auto-filled')
    } else {
      console.log('No result found')
    }

    await page.screenshot({ path: 'automation/logs/step1-filled.png' })
    console.log('✓ Screenshot: step1-filled.png')

    // Check what zip and parcel look like after autofill
    const zipValue = await page.$eval('#ctl00_PlaceHolderMain_WorkLocationEdit_txtZip', el => el.value)
    const parcelValue = await page.$eval('#ctl00_PlaceHolderMain_ParcelEdit_txtParcelNo', el => el.value)
    const ownerValue = await page.$eval('#ctl00_PlaceHolderMain_OwnerEdit_txtName', el => el.value)
    console.log(`Zip after autofill: "${zipValue}"`)
    console.log(`Parcel after autofill: "${parcelValue}"`)
    console.log(`Owner after autofill: "${ownerValue}"`)

    // Continue to next page
    console.log('\nContinuing...')
    await page.click('#ctl00_PlaceHolderMain_actionBarBottom_btnContinue')
    await page.waitForTimeout(4000)
    const url = page.url()
    console.log(`✓ URL: ${url}`)
    await page.screenshot({ path: 'automation/logs/after-step1.png' })

    // Check for errors
    const errors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ACA_Error, [class*="error"], .field-error'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 0 && t.length < 100)
    })
    if (errors.length > 0) {
      console.log('Errors on page:', errors)
    } else {
      console.log('No errors — continuing to Permit Detail...')
      await page.click('#ctl00_PlaceHolderMain_actionBarBottom_btnContinue')
      await page.waitForTimeout(4000)
      const url2 = page.url()
      console.log(`✓ URL: ${url2}`)
      await page.screenshot({ path: 'automation/logs/permit-detail.png' })
      console.log('✓ Screenshot: permit-detail.png')

      // Extract Permit Detail fields
      const fields = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select, textarea'))
          .map(el => {
            let label = ''
            const lbl = document.querySelector(`label[for="${el.id}"]`)
            if (lbl) label = lbl.textContent.trim()
            if (!label) {
              const td = el.closest('td')
              if (td && td.previousElementSibling) label = td.previousElementSibling.textContent.trim()
            }
            return { id: el.id, type: el.type || el.tagName, label, required: el.required }
          })
          .filter(f => f.id && !f.type.includes('hidden') && !f.id.includes('goog')
            && !f.id.includes('Calendar') && !f.id.includes('closeWin')
            && !f.id.includes('search_text') && !f.id.includes('menuitem'))
      })

      console.log('\n=== PERMIT DETAIL FIELDS ===\n')
      fields.forEach(f => {
        console.log(`"${f.label || '(no label)'}" → #${f.id} (${f.type})${f.required ? ' *required' : ''}`)
      })
      console.log(`\nTotal: ${fields.length} fields`)
    }

    console.log('\nBrowser open 60 seconds')
    await page.waitForTimeout(60000)

  } catch (err) {
    console.error('\nFailed:', err.message)
    try {
      const pages = browser.contexts()[0]?.pages()
      if (pages && pages[0]) await pages[0].screenshot({ path: 'automation/logs/extract-error.png' })
    } catch(e) {}
  } finally {
    await browser.close()
  }
}

run()