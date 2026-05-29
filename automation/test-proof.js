require('dotenv').config({ path: '.env.local' })
const { startProofNotarization } = require('./proof-runner')
const { createClient } = require('@supabase/supabase-js')

async function testProof() {
  console.log('Testing Proof notarization automation...\n')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .not('noc_file_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!job) {
    console.error('No job with NOC found')
    return
  }

  console.log('Using job: ' + job.owner_name + ' — ' + job.property_address)
  console.log('NOC file: ' + job.noc_file_path)

  const { data: nocData, error } = await supabase
    .storage.from('job-documents').download(job.noc_file_path)

  if (error) {
    console.error('Could not download NOC:', error.message)
    return
  }

  const pdfBytes = await nocData.arrayBuffer()
  console.log('NOC downloaded — ' + pdfBytes.byteLength + ' bytes\n')

  await startProofNotarization(job.id, job, pdfBytes)
}

testProof().catch(console.error)