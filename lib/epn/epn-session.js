// lib/epn/epn-session.js
// ePN browser session helpers (inspect-only — no submissions)

const { chromium } = require('playwright')
const { mkdirSync } = require('fs')
const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')
const { validateEpnCredentials } = require('./validate-credentials')
const { getCredential } = require('../credentials/credential-loader')

async function fillFirstVisible(page, selectors, value) {
  var list = String(selectors).split(',').map(function(s) { return s.trim() })
  for (var i = 0; i < list.length; i++) {
    var el = await page.$(list[i])
    if (!el) continue
    await el.fill(value)
    return list[i]
  }
  return null
}

async function login(page, options) {
  var opts = options || {}
  var creds = await getCredential({ provider: 'epn', companyId: opts.companyId || null })

  console.log('Logging into ePN...')
  await page.goto(epnConfig.loginUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  var emailSelector = await fillFirstVisible(page, epnConfig.selectors.loginEmail, creds.email)
  if (!emailSelector) throw new Error('Could not find ePN email/login field')

  await page.waitForTimeout(400)
  var passwordSelector = await fillFirstVisible(page, epnConfig.selectors.loginPassword, creds.password)
  if (!passwordSelector) throw new Error('Could not find ePN password field')

  await page.waitForTimeout(400)

  var clicked = await page.evaluate(function() {
    var candidates = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, a'))
    var loginBtn = candidates.find(function(el) {
      var text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()
      return /log\s*in|sign\s*in|submit/i.test(text)
    })
    if (loginBtn) {
      loginBtn.click()
      return true
    }
    return false
  })

  if (!clicked) {
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(5000)
  console.log('Logged in: ' + page.url())
}

async function withEpnSession(handler, options) {
  var opts = options || {}
  var credentialError = await validateEpnCredentials(opts.companyId || null)
  if (credentialError) {
    return { success: false, skipped: true, reason: credentialError }
  }

  mkdirSync('automation/logs', { recursive: true })
  var browser = await chromium.launch({
    headless: !!(opts.headless),
    slowMo: opts.slowMo || 400,
  })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)
  page.on('dialog', async function(dialog) {
    console.log('ePN dialog: ' + dialog.type() + ' — ' + dialog.message())
    await dialog.accept()
  })

  try {
    await login(page, { companyId: opts.companyId || null })
    return await handler(page)
  } finally {
    await browser.close()
  }
}

module.exports = {
  epnConfig,
  login,
  withEpnSession,
}
