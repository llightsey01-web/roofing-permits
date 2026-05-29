require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { Solver } = require('2captcha')

async function testNavigate() {
  console.log('Starting navigation test...\n')

  const username = process.env.POLK_COUNTY_USERNAME
  const password = process.env.POLK_COUNTY_PASSWORD
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY
  const solver = new Solver(twoCaptchaKey)

  const browser = await chromium.launch({ headless: false, slowMo: 800 })
  const page = await browser.newPage()

  try {
    // Login
    console.log('Step 1: Logging in...')
    await page.goto('https://aca-prod.accela.com/POLKCO/Login.aspx')
    await page.waitForLoadState('networkidle')

    const frameHandle = await page.$('iframe')
    const frame = await frameHandle.contentFrame()

    const usernameField = await frame.waitForSelector('[name="username"]', { timeout: 10000 })
    await usernameField.fill(username)
    const passwordField = await frame.waitForSelector('[name="password"]', { timeout: 10000 })
    await passwordField.fill(password)

    const siteKey = '6LcsG08UAAAAANjzx4qNeHD3__8lwLWcwfnrpWln'
    const result = await solver.recaptcha(siteKey, 'https://aca-prod.accela.com/POLKCO/Login.aspx')
    const token = result.data

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
    }, token)

    await page.waitForTimeout(1500)
    await frame.evaluate(() => {
      const buttons = document.querySelectorAll('button')
      for (const btn of buttons) {
        if (btn.textContent.includes('Sign In') || btn.textContent.includes('SIGN IN')) {
          btn.click()
          return
        }
      }
    })

    await page.waitForTimeout(3000)
    await page.waitForLoadState('networkidle')
    console.log('✓ Logged in')

    // Navigate to disclaimer
    console.log('\nStep 2: Navigating to Building permit...')
    await page.goto('https://aca-prod.accela.com/POLKCO/Cap/CapApplyDisclaimer.aspx?module=Building')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    console.log('✓ Disclaimer page loaded')

    // Accept disclaimer
    console.log('\nStep 3: Accepting disclaimer...')
    const checkbox = await page.waitForSelector('input[type="checkbox"]', { timeout: 10000 })
    await checkbox.check()
    await page.waitForTimeout(500)
    await page.click('text=Continue Application')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    console.log('✓ Disclaimer accepted')

    // Select Re-Roof Permit
    console.log('\nStep 4: Selecting Re-Roof Permit...')
    const reRoofRadio = await page.waitForSelector('input[type="radio"] + label:has-text("Re-Roof"), label:has-text("Re-Roof Permit")', { timeout: 10000 })
      .catch(() => null)

    if (reRoofRadio) {
      await reRoofRadio.click()
      console.log('✓ Re-Roof Permit selected via label')
    } else {
      // Try clicking by text
      await page.click('text=Re-Roof Permit')
      console.log('✓ Re-Roof Permit selected via text')
    }

    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'automation/logs/04-reroof-selected.png' })
    console.log('✓ Screenshot saved: 04-reroof-selected.png')

    // Click Continue Application
    console.log('\nStep 5: Clicking Continue Application...')
    await page.click('text=Continue Application')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    console.log(`✓ URL: ${page.url()}`)

    await page.screenshot({ path: 'automation/logs/05-after-type-select.png' })
    console.log('✓ Screenshot saved: 05-after-type-select.png')

    // Show what's on the next page
    const headings = await page.evaluate(() => {
      const els = document.querySelectorAll('h1, h2, h3, h4, .panel-title, label, td')
      return Array.from(els).map(el => el.textContent.trim()).filter(t => t.length > 2 && t.length < 100).slice(0, 30)
    })
    console.log('\nFields/headings on next page:')
    headings.forEach(h => console.log(' ', h))

    console.log('\n========================================')
    console.log('BROWSER STAYING OPEN FOR 60 SECONDS')
    console.log('========================================\n')

    await page.waitForTimeout(60000)

  } catch (err) {
    console.error('\nTest failed:', err.message)
    await page.screenshot({ path: 'automation/logs/navigate-error.png' })
  } finally {
    await browser.close()
  }
}

testNavigate()