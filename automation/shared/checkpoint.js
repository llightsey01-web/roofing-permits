// automation/shared/checkpoint.js
// Checkpoint management for automation recovery
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function saveCheckpoint(runId, stepName, stepNumber, data) {
  const supabase = getSupabase()
  await supabase.from('automation_runs').update({
    last_completed_step: stepName,
    last_completed_step_number: stepNumber,
    checkpoint_data: data || {},
  }).eq('id', runId)
  console.log('[checkpoint] Saved: step ' + stepNumber + ' — ' + stepName)
}

async function getCheckpoint(runId) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('automation_runs')
    .select('last_completed_step, last_completed_step_number, checkpoint_data, resume_from_step')
    .eq('id', runId)
    .single()
  return data
}

async function shouldSkipStep(runId, stepNumber) {
  const checkpoint = await getCheckpoint(runId)
  if (!checkpoint || !checkpoint.last_completed_step_number) return false
  return stepNumber <= checkpoint.last_completed_step_number
}

module.exports = { saveCheckpoint, getCheckpoint, shouldSkipStep }
