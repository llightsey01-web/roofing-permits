require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const TEST_SCOPE = 'Remove and replace existing shingle roof'
const DEFAULT_JOB_ID = '766b067e-f776-47d7-883e-ded938b66ddf'

async function main() {
  const jobId = process.argv[2] || DEFAULT_JOB_ID
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('Updating job scope_of_work...')
  const { error: updateError } = await supabase
    .from('jobs')
    .update({ scope_of_work: TEST_SCOPE })
    .eq('id', jobId)

  if (updateError) throw new Error('Failed to update job: ' + updateError.message)

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  if (job.scope_of_work !== TEST_SCOPE) {
    throw new Error('Job scope_of_work not saved correctly: ' + job.scope_of_work)
  }
  console.log('✓ jobs.scope_of_work saved: ' + job.scope_of_work)

  let company = null
  if (job.company_id) {
    const { data: companyData } = await supabase
      .from('companies')
      .select('id, name, address, city, state, zip, phone, license_number')
      .eq('id', job.company_id)
      .single()
    company = companyData
  }

  const { generateNOC, getNocScopeOfWork } = await import('../lib/noc/noc-pipeline.js')
  const mappedScope = getNocScopeOfWork(job)
  if (mappedScope !== TEST_SCOPE) {
    throw new Error('Scope mapping failed: ' + mappedScope)
  }
  console.log('✓ NOC scope mapping: ' + mappedScope)

  const { pdfBytes, generalDescription, filePath } = await generateNOC(jobId, job, company)
  if (generalDescription !== TEST_SCOPE) {
    throw new Error('Generated general description mismatch: ' + generalDescription)
  }
  console.log('✓ NOC field value: ' + generalDescription)

  const outDir = join('automation', 'logs', 'noc-scope-test-' + Date.now())
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'noc-filled.pdf')
  writeFileSync(outPath, Buffer.from(pdfBytes))
  console.log('Saved: ' + outPath)
  console.log('Storage path: ' + filePath)
  console.log('\nPASS — scope_of_work mapped to General description of improvement')
}

main().catch(function(err) {
  console.error('FAIL:', err.message)
  process.exit(1)
})
