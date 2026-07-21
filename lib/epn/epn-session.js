// lib/epn/epn-session.js
// ePN browser session helpers (inspect-only — no submissions)

const { chromium } = require('playwright')
const { mkdirSync } = require('fs')
const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')
const { validateEpnCredentials } = require('./validate-credentials')
const { getCredential } = require('../credentials/credential-loader')
const {
  withSession,
  clearSession,
} = require('../automation/session-store')

// Docker/Railway: avoid /dev/shm OOM kills and common Chromium container crashes.
var EPN_CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--disable-background-networking',
  '--mute-audio',
]

/**
 * ePN-only session check — avoids page.content() (full HTML into Node heap).
 * Shared session-store.isSessionValid is intentionally unused here.
 */
async function isEpnSessionValid(page) {
  var url = String(page.url() || '').toLowerCase()
  if (!url || url === 'about:blank') return false
  if (/\/login\.aspx|\/signin|\/account\/login/i.test(url)) return false

  // Prefer lightweight DOM probes over dumping the full ASP.NET document.
  var markers = await page.evaluate(function () {
    var bodyText = ((document.body && document.body.innerText) || '').slice(0, 2000).toLowerCase()
    var hasPassword = !!document.querySelector('input[type="password"]')
    var hasUserField = !!(
      document.querySelector('input[type="email"]') ||
      document.querySelector('input[name*="Email"], input[id*="Email"], input[name*="User"], input[id*="User"]')
    )
    var hasLoginForm = hasPassword && hasUserField
    var hasAppShell = !!(
      document.querySelector('#AddPackage-button, #TextSearchAng, #AddDocuments, #DeletePkgBtn')
    )
    var expired =
      bodyText.indexOf('your session has expired') >= 0 ||
      bodyText.indexOf('please log in') >= 0 ||
      bodyText.indexOf('session timeout') >= 0 ||
      bodyText.indexOf('sign in to continue') >= 0
    return { hasLoginForm: hasLoginForm, hasAppShell: hasAppShell, expired: expired }
  })

  if (markers.expired) return false
  if (markers.hasAppShell) return true
  if (markers.hasLoginForm) return false
  // Landed off login without obvious shell — treat as valid enough to proceed;
  // login() will run if the next navigation hits the login wall.
  return !/login|signin/.test(url)
}

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
  var companyId = opts.companyId || null
  var credentialError = await validateEpnCredentials(companyId)
  if (credentialError) {
    return { success: false, skipped: true, reason: credentialError }
  }

  mkdirSync('automation/logs', { recursive: true })
  var browser = await chromium.launch({
    headless: !!(opts.headless),
    slowMo: opts.slowMo || 400,
    args: EPN_CHROMIUM_ARGS,
  })

  try {
    return await withSession('epn', companyId, browser, async function (page) {
      page.setDefaultTimeout(45000)
      page.on('dialog', async function(dialog) {
        console.log('ePN dialog: ' + dialog.type() + ' — ' + dialog.message())
        await dialog.accept()
      })
      await page.goto(epnConfig.loginUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      var valid = await isEpnSessionValid(page)
      if (!valid) {
        console.log('[epn] Session expired — logging in fresh')
        await clearSession('epn', companyId)
        await login(page, { companyId: companyId })
        console.log('[epn] Login complete — session saved for next run')
      } else {
        console.log('[epn] Using saved session — skipping login ✓')
      }
      return await handler(page)
    })
  } finally {
    await browser.close()
  }
}

module.exports = {
  epnConfig,
  login,
  withEpnSession,
  isEpnSessionValid,
}
