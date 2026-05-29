require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { Solver } = require('2captcha')

async function loginOnce(attemptNumber, solver, username, password) {
  console.log(`\n--- Attempt ${attemptNumber}/20 ---`)
  
  const browser = await chromium.launch({ headless: true }) // headless for speed
  const page = await browser.newPage()

  try {
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
      document.querySelectorAll('[id="g-recaptcha-response"], [name="g-recaptcha-response"]').forEach(el => {
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
              if (key === 'callback' && typeof obj[key] === 'function') {
                obj[key](token)
              } else {
                tryCallback(obj[key], token, depth + 1)
              }
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

    const currentUrl = page.url()

    if (!currentUrl.includes('Login.aspx')) {
      console.log(`✓ Attempt ${attemptNumber}: SUCCESS — ${currentUrl}`)
      return { success: true, attempt: attemptNumber }
    } else {
      console.log(`✗ Attempt ${attemptNumber}: FAILED — still on login page`)
      return { success: false, attempt: attemptNumber, error: 'Still on login page' }
    }

  } catch (err) {
    console.log(`✗ Attempt ${attemptNumber}: ERROR — ${err.message}`)
    return { success: false, attempt: attemptNumber, error: err.message }
  } finally {
    await browser.close()
  }
}

async function runStressTest() {
  console.log('Starting 20-run login stress test...')
  console.log('Running headless for speed\n')

  const username = process.env.POLK_COUNTY_USERNAME
  const password = process.env.POLK_COUNTY_PASSWORD
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY

  const solver = new Solver(twoCaptchaKey)

  const results = []
  const startTime = Date.now()

  for (let i = 1; i <= 20; i++) {
    const result = await loginOnce(i, solver, username, password)
    results.push(result)
    // Wait 3 seconds between attempts to avoid rate limiting
    if (i < 20) await new Promise(r => setTimeout(r, 3000))
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  const successes = results.filter(r => r.success).length
  const failures = results.filter(r => !r.success).length

  console.log('\n========================================')
  console.log('STRESS TEST RESULTS')
  console.log('========================================')
  console.log(`Total attempts:  20`)
  console.log(`Successes:       ${successes}`)
  console.log(`Failures:        ${failures}`)
  console.log(`Success rate:    ${(successes / 20 * 100).toFixed(0)}%`)
  console.log(`Total time:      ${elapsed} minutes`)
  console.log('========================================')

  if (failures > 0) {
    console.log('\nFailed attempts:')
    results.filter(r => !r.success).forEach(r => {
      console.log(`  Attempt ${r.attempt}: ${r.error}`)
    })
  }
}

runStressTest()