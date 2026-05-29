require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')

async function testPortal() {
  console.log('Starting dry run test...')
  console.log('Opening Polk County portal...\n')

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
  })

  const page = await browser.newPage()

  try {
    console.log('Step 1: Navigating to portal...')
    await page.goto('https://aca-prod.accela.com/POLKCO/Login.aspx')
    await page.waitForLoadState('networkidle')
    console.log('✓ Portal loaded')

    console.log('Step 2: Taking screenshot...')
    await page.screenshot({ path: 'automation/logs/test-portal.png' })
    console.log('✓ Screenshot saved to automation/logs/test-portal.png')

    const title = await page.title()
    console.log(`✓ Page title: ${title}`)

    console.log('\n========================================')
    console.log('DRY RUN COMPLETE')
    console.log('Browser will close in 5 seconds')
    console.log('========================================\n')

    await page.waitForTimeout(5000)

  } catch (err) {
    console.error('Test failed:', err.message)
  } finally {
    await browser.close()
  }
}

testPortal()