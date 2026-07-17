'use strict'

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * Log a single automation action to run_actions.
 */
async function logRunAction(entry) {
  var supabase = getSupabase()
  if (!supabase) {
    console.warn('[run-logger] Supabase not configured')
    return { ok: false, error: 'no_supabase' }
  }

  var row = {
    run_id: entry.runId || null,
    job_id: entry.jobId || null,
    company_id: entry.companyId || null,
    action: entry.action,
    status: entry.status,
    step_number: entry.stepNumber != null ? entry.stepNumber : null,
    step_name: entry.stepName || null,
    portal_response: entry.portalResponse || null,
    screenshot_path: entry.screenshotPath || null,
    file_path: entry.filePath || null,
    error_message: entry.errorMessage || null,
    duration_ms: entry.durationMs != null ? entry.durationMs : null,
    metadata: entry.metadata || {},
    created_at: new Date().toISOString(),
  }

  try {
    var { error } = await supabase.from('run_actions').insert(row)
    if (error) {
      console.warn('[run-logger] insert failed:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[run-logger] error:', err.message)
    return { ok: false, error: err.message }
  }
}

/**
 * Capture failure forensics to Storage + automation_logs + run_actions.
 * @param {object} opts
 * @param {object} [opts.page] — Playwright page (optional)
 */
async function captureFailureForensics(opts) {
  var options = opts || {}
  var supabase = getSupabase()
  var jobId = options.jobId
  var runId = options.runId
  var companyId = options.companyId || null
  var err = options.error || new Error('unknown')
  var stepNumber = options.stepNumber != null ? options.stepNumber : 99
  var stepName = options.stepName || 'error'
  var page = options.page || null
  var stamp = new Date().toISOString().replace(/[:.]/g, '-')
  var basePath = 'jobs/' + jobId + '/forensics/' + stamp
  var screenshotPath = null
  var htmlPath = null
  var currentUrl = null

  if (page && typeof page.url === 'function') {
    try { currentUrl = page.url() } catch (e) {}
  }

  if (supabase && page) {
    try {
      if (typeof page.screenshot === 'function') {
        var png = await page.screenshot({ fullPage: true, type: 'png' })
        screenshotPath = basePath + '/screenshot.png'
        await supabase.storage.from('job-documents').upload(screenshotPath, png, {
          contentType: 'image/png',
          upsert: true,
        })
      }
    } catch (shotErr) {
      console.warn('[forensics] screenshot failed:', shotErr.message)
    }

    try {
      if (typeof page.content === 'function') {
        var html = await page.content()
        htmlPath = basePath + '/page.html'
        await supabase.storage.from('job-documents').upload(htmlPath, Buffer.from(html, 'utf8'), {
          contentType: 'text/html',
          upsert: true,
        })
      }
    } catch (htmlErr) {
      console.warn('[forensics] html snapshot failed:', htmlErr.message)
    }
  }

  if (supabase) {
    try {
      var meta = {
        url: currentUrl,
        stack: err.stack || null,
        html_path: htmlPath,
        timestamp: stamp,
      }
      await supabase.from('automation_logs').insert({
        run_id: runId || null,
        step_number: stepNumber,
        step_name: stepName,
        success: false,
        notes: err.message,
        raw_error: err.stack || '',
        screenshot_path: screenshotPath,
      })
      // Some schemas may not have screenshot_path on automation_logs — ignore if insert fails above partially
    } catch (logErr) {
      console.warn('[forensics] automation_logs insert failed:', logErr.message)
      try {
        await supabase.from('automation_logs').insert({
          run_id: runId || null,
          step_number: stepNumber,
          step_name: stepName,
          success: false,
          notes: err.message,
          raw_error: (err.stack || '') + (currentUrl ? '\nURL: ' + currentUrl : ''),
        })
      } catch (e2) {}
    }
  }

  await logRunAction({
    runId: runId,
    jobId: jobId,
    companyId: companyId,
    action: 'failure_forensics',
    status: 'failure',
    stepNumber: stepNumber,
    stepName: stepName,
    portalResponse: currentUrl,
    screenshotPath: screenshotPath,
    filePath: htmlPath,
    errorMessage: err.message,
    metadata: {
      stack: err.stack || null,
      url: currentUrl,
    },
  })

  return {
    screenshotPath: screenshotPath,
    htmlPath: htmlPath,
    url: currentUrl,
    basePath: basePath,
  }
}

module.exports = {
  logRunAction,
  captureFailureForensics,
}
