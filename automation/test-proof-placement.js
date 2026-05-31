require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { calibrateProofPlacement } = require('./proof-runner')
const { validateProofCredentials } = require('../lib/proof/send-noc-to-proof')
const proofConfig = require('./ahjs/configs/proof.config')

async function loadPdfBytes(jobId, pdfPath) {
  if (pdfPath) {
    var fs = require('fs')
    var buf = fs.readFileSync(pdfPath)
    console.log('Using local PDF: ' + pdfPath + ' (' + buf.length + ' bytes)')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  if (!jobId) throw new Error('Provide jobId or --pdf <path>')

  var supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  var { data: job, error } = await supabase
    .from('jobs')
    .select('id, noc_file_path, owner_name, property_address')
    .eq('id', jobId)
    .single()

  if (error || !job) throw new Error('Job not found: ' + jobId)
  if (!job.noc_file_path) throw new Error('Job has no noc_file_path')

  console.log('Job: ' + job.owner_name + ' — ' + job.property_address)
  console.log('NOC file: ' + job.noc_file_path)

  var { data: pdfData, error: downloadError } = await supabase.storage
    .from('job-documents')
    .download(job.noc_file_path)

  if (downloadError || !pdfData) {
    throw new Error('Failed to download NOC: ' + (downloadError?.message || 'empty file'))
  }

  var pdfBytes = await pdfData.arrayBuffer()
  console.log('NOC downloaded — ' + pdfBytes.byteLength + ' bytes')
  return pdfBytes
}

async function main() {
  var args = process.argv.slice(2)
  var jobId = null
  var pdfPath = null

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--pdf' && args[i + 1]) {
      pdfPath = args[i + 1]
      i++
    } else if (!args[i].startsWith('--')) {
      jobId = args[i]
    }
  }

  console.log('========================================')
  console.log('PROOF PLACEMENT CALIBRATION')
  console.log('========================================')
  console.log('Does NOT send live transactions.')
  console.log('Frozen production proofPlacement:')
  console.log(JSON.stringify(proofConfig.FROZEN_PROOF_PLACEMENT, null, 2))
  console.log('========================================\n')

  var credentialError = validateProofCredentials()
  if (credentialError) {
    console.error('Calibration aborted: ' + credentialError)
    process.exit(1)
  }

  var pdfBytes = await loadPdfBytes(jobId, pdfPath)
  var result = await calibrateProofPlacement(pdfBytes, { config: proofConfig })

  console.log('\nCalibration result:')
  console.log(JSON.stringify({
    success: result.success,
    outputDir: result.outputDir,
    fieldsPlaced: result.fieldsPlaced,
    fieldsVisibleAfter: result.fieldsVisibleAfter,
    manifestPath: result.outputDir + '/placement-manifest.json',
  }, null, 2))
  console.log('\nNext step: review screenshots in outputDir. Placement is frozen — edit proof.config.js only with approval.')
}

main().catch(function(err) {
  console.error('Calibration failed:', err.message)
  process.exit(1)
})
