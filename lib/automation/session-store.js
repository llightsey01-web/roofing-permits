'use strict'

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function saveSession(provider, companyId, storageState) {
  const supabase = getSupabase()
  if (!supabase) {
    console.log('[session] Failed to save ' + provider + ': supabase not configured')
    return false
  }
  const sessionPath = 'sessions/' + provider + '-' + companyId + '.json'
  const { error } = await supabase.storage
    .from('job-documents')
    .upload(sessionPath, Buffer.from(JSON.stringify(storageState)), {
      contentType: 'application/json',
      upsert: true,
    })
  if (error) {
    console.log('[session] Failed to save ' + provider + ':', error.message)
    return false
  }
  console.log('[session] Saved session for ' + provider)
  return true
}

async function loadSession(provider, companyId) {
  const supabase = getSupabase()
  if (!supabase) {
    console.log('[session] No saved session for ' + provider + ' — will login fresh')
    return null
  }
  const { data, error } = await supabase.storage
    .from('job-documents')
    .download('sessions/' + provider + '-' + companyId + '.json')
  if (error) {
    console.log('[session] No saved session for ' + provider + ' — will login fresh')
    return null
  }
  try {
    return JSON.parse(await data.text())
  } catch (err) {
    console.log('[session] Invalid session for ' + provider + ' — will login fresh')
    return null
  }
}

async function clearSession(provider, companyId) {
  const supabase = getSupabase()
  if (!supabase) return
  await supabase.storage
    .from('job-documents')
    .remove(['sessions/' + provider + '-' + companyId + '.json'])
  console.log('[session] Cleared session for ' + provider)
}

async function isSessionValid(page) {
  const url = page.url()
  const content = await page.content()
  const expiredIndicators = [
    'your session has expired',
    'please log in',
    'session timeout',
    'sign in to continue',
    '/login',
    '/signin',
  ]
  const urlLower = url.toLowerCase()
  const contentLower = content.toLowerCase()
  return !expiredIndicators.some(function (i) {
    return urlLower.includes(i) || contentLower.includes(i)
  })
}

/**
 * Accela portals land on Login.aspx even when checking cookies.
 * Treat redirect away from Login.aspx as a valid session.
 */
async function isAccelaSessionValid(page) {
  const url = (page.url() || '').toLowerCase()
  if (/dashboard\.aspx|welcome\.aspx|\/cap\//i.test(url) && !/login\.aspx/i.test(url)) {
    return true
  }
  if (/login\.aspx/i.test(url)) return false
  return isSessionValid(page)
}

async function withSession(provider, companyId, browser, fn) {
  const savedSession = await loadSession(provider, companyId)
  const context = savedSession
    ? await browser.newContext({ storageState: savedSession })
    : await browser.newContext()
  const page = await context.newPage()
  try {
    const result = await fn(page, context)
    const newState = await context.storageState()
    await saveSession(provider, companyId, newState)
    return result
  } catch (err) {
    if (/login|session|expired|unauthorized|sign.?in/i.test(err.message || '')) {
      console.log('[session] Session may have expired for ' + provider + ' — clearing')
      await clearSession(provider, companyId)
    }
    throw err
  } finally {
    await context.close()
  }
}

module.exports = {
  saveSession,
  loadSession,
  clearSession,
  isSessionValid,
  isAccelaSessionValid,
  withSession,
}
