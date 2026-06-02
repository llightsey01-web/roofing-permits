require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')

const LEE_AHJ_ID = '1752d716-71de-41f9-ae58-4f9ae37cc349'
const GAETANO_COMPANY_ID = '384062a1-38eb-4612-a01c-6ae467d5d22f'
const LOGIN_URL = 'https://aca-prod.accela.com/LEECO/Login.aspx'

async function loadLeeCredentials() {
  const mod = await import('../lib/credentials/secure-credential-service.js')
  return mod.getCredentials(GAETANO_COMPANY_ID, LEE_AHJ_ID)
}

async function main() {
  console.log('Lee County login test')
  console.log('Loading Gaetano credentials from database...')

  const credentials = await loadLeeCredentials()
  console.log('Username:', credentials.username)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    console.log('Opening', LOGIN_URL)
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    const frame = page.frame({ url: /login-panel/ })
    if (!frame) throw new Error('Angular login iframe not found')

    await frame.locator('[name="username"]').fill(credentials.username)
    await frame.locator('[name="password"]').fill(credentials.password)
    console.log('Credentials entered')

    await frame.locator('button:has-text("Sign In")').click()
    await page.waitForTimeout(5000)
    await page.waitForLoadState('networkidle').catch(function() {})

    const currentUrl = page.url()
    const title = await page.title()
    const stillOnLogin = /Login\.aspx/i.test(currentUrl)

    if (stillOnLogin) {
      const loginFrame = page.frame({ url: /login-panel/ })
      const errorText = loginFrame
        ? await loginFrame.locator('.error, .alert, [class*="error"], [class*="Error"]').allTextContents().catch(function() { return [] })
        : []

      console.log('\n✗ LOGIN FAILED — still on login page')
      console.log('URL:', currentUrl)
      if (errorText.length) console.log('Portal errors:', errorText.join(' | '))
      process.exitCode = 1
      return
    }

    console.log('\n✓ LOGIN SUCCESS')
    console.log('URL:', currentUrl)
    console.log('Title:', title)
    console.log('Note: Lee County uses Angular CommunityView login — no reCAPTCHA on this flow')
  } finally {
    await browser.close()
  }
}

main().catch(function(err) {
  console.error('\nTest error:', err.message)
  process.exit(1)
})
