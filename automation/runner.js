// automation/runner.js
// Main entry point for all automation runs
// Receives jobId and runId, loads job data, picks correct AHJ script, runs it

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function runAutomation(jobId, runId) {
  const supabase = getSupabase()

  console.log(`\nLoading job ${jobId}...`)

  // Load job with all related data
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select(`
      *,
      ahj_portals (*),
      job_documents (*)
    `)
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  if (!job.ahj_portals) {
    throw new Error(`No AHJ assigned to job ${jobId}. Please assign an AHJ before running automation.`)
  }

  console.log(`Job loaded: ${job.owner_name} — ${job.property_address}`)
  console.log(`AHJ: ${job.ahj_portals.name}`)
  console.log(`Workflow file: ${job.ahj_portals.workflow_file}`)

  // Load credentials from environment
  const credentialKey = job.ahj_portals.credential_key
  const username = process.env[`${credentialKey}_USERNAME`]
  const password = process.env[`${credentialKey}_PASSWORD`]

  if (!username || !password) {
    throw new Error(`No credentials found for ${credentialKey}. Add ${credentialKey}_USERNAME and ${credentialKey}_PASSWORD to .env.local`)
  }

  // Build job data object for the runner
  const jobData = {
    ...job,
    credentials: { username, password },
    documents: job.job_documents || [],
  }

  // Update run status to running
  await supabase.from('automation_runs')
    .update({ run_status: 'running', started_at: new Date().toISOString() })
    .eq('id', runId)

  await supabase.from('jobs')
    .update({ job_status: 'automation_running' })
    .eq('id', jobId)

  // Load and run the correct AHJ workflow
  const workflowFile = job.ahj_portals.workflow_file

  switch (workflowFile) {
    case 'polk-county.runner.js': {
      const { runPolkCounty } = require('./ahjs/polk-county.runner')
      await runPolkCounty(jobData, runId)
      break
    }
    default:
      throw new Error(`No runner found for workflow file: ${workflowFile}`)
  }
}

// Allow running directly from command line for testing
// node automation/runner.js <jobId> <runId>
if (require.main === module) {
  const jobId = process.argv[2]
  const runId = process.argv[3]

  if (!jobId || !runId) {
    console.log('Usage: node automation/runner.js <jobId> <runId>')
    process.exit(1)
  }

  runAutomation(jobId, runId)
    .then(() => {
      console.log('Automation completed successfully')
      process.exit(0)
    })
    .catch(err => {
      console.error('Automation failed:', err.message)
      process.exit(1)
    })
}

module.exports = { runAutomation }