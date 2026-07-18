// automation/shared/screenshot.js
// Wraps every automation step — takes screenshot, saves log row, handles errors
// When automation_runs.payload has workflow_run_id, also mirrors into workflow_artifacts/logs
const { createClient } = require('@supabase/supabase-js')
const { saveCheckpoint, shouldSkipStep } = require('./checkpoint.js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function mirrorToWorkflow(opts) {
  try {
    var { getObservability } = require('../../lib/workflow/observability.js')
    var obs = getObservability()
    await obs.mirrorLegacyCapture(opts)
  } catch (err) {
    console.warn('[observability] mirror skipped:', err.message)
  }
}

async function captureFailureForensics(page, runId, stepName, err) {
  const supabase = getSupabase()
  const timestamp = Date.now()
  const basePath = `runs/${runId}/failures/${stepName}-${timestamp}`

  try {
    const screenshot = await page.screenshot({ fullPage: true })
    await supabase.storage.from('screenshots').upload(
      basePath + '-full.png',
      screenshot,
      { upsert: true }
    )

    const html = await page.content()
    await supabase.storage.from('screenshots').upload(
      basePath + '.html',
      Buffer.from(html),
      { upsert: true, contentType: 'text/html' }
    )

    const url = page.url()
    const title = await page.title().catch(() => 'unknown')

    const diagnostics = {
      url,
      title,
      errorMessage: err.message,
      errorStack: err.stack,
      timestamp: new Date().toISOString(),
      screenshotPath: basePath + '-full.png',
      htmlPath: basePath + '.html',
    }

    await supabase.from('automation_logs').insert({
      run_id: runId,
      step_name: stepName + '_failure_forensics',
      success: false,
      notes: JSON.stringify(diagnostics),
      raw_error: err.message,
      logged_at: new Date().toISOString(),
    })

    await mirrorToWorkflow({
      legacyRunId: runId,
      stepName: stepName,
      label: 'failure_forensics',
      screenshotPath: diagnostics.screenshotPath,
      htmlPath: diagnostics.htmlPath,
      storageBucket: 'screenshots',
      success: false,
      url: url,
      source: 'playwright_logStep',
    })

    console.log('[forensics] Captured failure evidence for step: ' + stepName)
    return diagnostics
  } catch (forensicsErr) {
    console.error('[forensics] Failed to capture evidence:', forensicsErr.message)
  }
}

async function logStep(page, runId, stepNumber, stepName, fn, checkpointData) {
  const supabase = getSupabase()
  const screenshotPath = `runs/${runId}/step-${String(stepNumber).padStart(2, '0')}-${stepName}.png`

  if (await shouldSkipStep(runId, stepNumber)) {
    console.log(`↷ Step ${stepNumber}: ${stepName} (skipped — checkpoint)`)
    return { success: true, skipped: true }
  }

  try {
    await fn()

    await saveCheckpoint(runId, stepName, stepNumber, checkpointData || {})

    const screenshot = await page.screenshot({ fullPage: false })
    await supabase.storage.from('screenshots').upload(screenshotPath, screenshot, { upsert: true })
    await supabase.from('automation_logs').insert({
      run_id: runId,
      step_number: stepNumber,
      step_name: stepName,
      success: true,
      screenshot_path: screenshotPath,
      logged_at: new Date().toISOString(),
    })

    await mirrorToWorkflow({
      legacyRunId: runId,
      stepNumber: stepNumber,
      stepName: stepName,
      screenshotPath: screenshotPath,
      storageBucket: 'screenshots',
      success: true,
      source: 'playwright_logStep',
    })

    console.log(`✓ Step ${stepNumber}: ${stepName}`)
    return { success: true }
  } catch (err) {
    await captureFailureForensics(page, runId, stepName, err)

    const screenshot = await page.screenshot({ fullPage: false }).catch(() => null)
    if (screenshot) {
      await supabase.storage.from('screenshots').upload(screenshotPath, screenshot, { upsert: true })
    }
    await supabase.from('automation_logs').insert({
      run_id: runId,
      step_number: stepNumber,
      step_name: stepName,
      success: false,
      screenshot_path: screenshot ? screenshotPath : null,
      raw_error: err.message,
      logged_at: new Date().toISOString(),
    })

    if (screenshot) {
      await mirrorToWorkflow({
        legacyRunId: runId,
        stepNumber: stepNumber,
        stepName: stepName,
        screenshotPath: screenshotPath,
        storageBucket: 'screenshots',
        success: false,
        source: 'playwright_logStep',
      })
    }

    console.log(`✗ Step ${stepNumber}: ${stepName} — ${err.message}`)
    throw err
  }
}

module.exports = { logStep, captureFailureForensics }
