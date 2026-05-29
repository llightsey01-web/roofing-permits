// automation/shared/screenshot.js
// Wraps every automation step — takes screenshot, saves log row, handles errors
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function logStep(page, runId, stepNumber, stepName, fn) {
  const supabase = getSupabase()
  const screenshotPath = `runs/${runId}/step-${String(stepNumber).padStart(2,'0')}-${stepName}.png`
  try {
    await fn()
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
    console.log(`✓ Step ${stepNumber}: ${stepName}`)
    return { success: true }
  } catch (err) {
    const screenshot = await page.screenshot({ fullPage: false })
    await supabase.storage.from('screenshots').upload(screenshotPath, screenshot, { upsert: true })
    await supabase.from('automation_logs').insert({
      run_id: runId,
      step_number: stepNumber,
      step_name: stepName,
      success: false,
      screenshot_path: screenshotPath,
      raw_error: err.message,
      logged_at: new Date().toISOString(),
    })
    console.log(`✗ Step ${stepNumber}: ${stepName} — ${err.message}`)
    throw err
  }
}

module.exports = { logStep }