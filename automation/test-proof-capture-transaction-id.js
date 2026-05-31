require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { mkdirSync } = require('fs')
const { join } = require('path')
const proofConfig = require('./ahjs/configs/proof.config')
const { login } = require('../lib/proof/proof-session')
const { validateProofCredentials } = require('../lib/proof/send-noc-to-proof')
const { captureProofTransactionId } = require('../lib/proof/transaction-id')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function buildProofJobSpecs(existingSpecs, proofMeta) {
  var specs = existingSpecs && typeof existingSpecs === 'object' ? existingSpecs : {}
  return Object.assign({}, specs, { proof: proofMeta })
}

async function main() {
  var jobId = process.argv[2] || '766b067e-f776-47d7-883e-ded938b66ddf'
  var credentialError = validateProofCredentials()
  if (credentialError) {
    console.error('Aborted: ' + credentialError)
    process.exit(1)
  }

  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  console.log('Backfilling Proof transaction ID for job ' + jobId)
  console.log('Signer: ' + job.owner_name + ' <' + job.owner_email + '>')
  console.log('Does NOT resend — records scrape only')

  var outputDir = join('automation', 'logs', 'proof-transaction-id-' + Date.now())
  mkdirSync(outputDir, { recursive: true })

  var browser = await chromium.launch({ headless: false, slowMo: 400 })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)

  try {
    await login(page)
    var capture = await captureProofTransactionId(page, job, {
      jobId: jobId,
      outputDir: outputDir,
      openDetailPage: true,
      sentAt: job.job_specs && job.job_specs.proof ? job.job_specs.proof.sent_at : job.noc_sent_at,
    })

    if (capture.matchRejected) {
      console.error('Capture rejected: ' + capture.rejectionReason)
      console.log('Best candidate: ' + capture.transactionId)
      process.exit(1)
    }

    console.log('Captured transaction ID: ' + capture.transactionId)
    console.log('Source: ' + capture.transaction_id_source)
    console.log('Match confidence: ' + (capture.matchResult && capture.matchResult.proof_match_confidence))

    var existingProof = job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
    var { buildProofMatchMeta } = require('../lib/proof/job-identity')
    var proofMeta = Object.assign({}, existingProof, {
      transaction_id: capture.transactionId,
      transaction_id_source: capture.transaction_id_source,
      transaction_id_captured_at: new Date().toISOString(),
      signer_name: job.owner_name,
      signer_email: job.owner_email,
      document_id: job.noc_file_path || existingProof.document_id || null,
      signature_placement: existingProof.signature_placement || 'configured',
      proofPlacement: proofConfig.proofPlacement,
      transaction_capture_output_dir: outputDir,
      transaction_href: capture.href || null,
      transaction_detail_url: capture.detailUrl || null,
    })

    if (capture.matchResult) {
      Object.assign(proofMeta, buildProofMatchMeta(capture.matchResult))
    }

    var { error: updateError } = await supabase.from('jobs').update({
      job_specs: buildProofJobSpecs(job.job_specs, proofMeta),
    }).eq('id', jobId)

    if (updateError) throw new Error('Failed to update job: ' + updateError.message)

    console.log('\nSaved to job_specs.proof:')
    console.log(JSON.stringify(proofMeta, null, 2))
    console.log('\nOutput dir: ' + outputDir)
  } finally {
    await browser.close()
  }
}

main().catch(function(err) {
  console.error('Capture failed:', err.message)
  process.exit(1)
})
