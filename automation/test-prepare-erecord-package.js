require('dotenv').config({ path: '.env.local' })
const { prepareRecordingPackage } = require('../lib/erecord/service')
const { SendPackageSafetyError } = require('../lib/epn/submit-safety')

async function main() {
  var jobId = process.argv[2]
  if (!jobId) {
    console.error('Usage: node automation/test-prepare-erecord-package.js <jobId>')
    process.exit(1)
  }

  console.log('========================================')
  console.log('PREPARE eRECORD PACKAGE (save-only)')
  console.log('========================================')
  console.log('Job ID: ' + jobId)
  console.log('HARD RULE: #SendPackage is NEVER clicked')
  console.log('========================================\n')

  var result = await prepareRecordingPackage(jobId, { headless: false })

  console.log('\n========================================')
  console.log('RESULT')
  console.log('========================================')
  console.log('Proof notarized file path: ' + result.notarizedFilePath)
  console.log('ePN package created: ' + (result.packId ? 'yes (packId=' + result.packId + ')' : 'no'))
  console.log('Package name: ' + (result.packageName || 'unknown'))
  console.log('Package URL: ' + (result.packageUrl || 'unknown'))
  console.log('Upload success: ' + result.uploadSuccess)
  console.log('Grantor Add success: ' + result.grantorAddSuccess)
  console.log('Grantee Add success: ' + result.granteeAddSuccess)
  console.log('Save success: ' + result.saveSuccess)
  console.log('Package status: ' + (result.packageStatus || 'unknown'))
  console.log('Document status: ' + (result.documentStatus || 'unknown'))
  console.log('Ready to Send confirmed: ' + result.readyConfirmed)
  console.log('Estimated fees: ' + (result.estimatedFees || 'unknown'))
  console.log('#SendPackage clicked: false')
  console.log('#SendPackage visible: ' + result.sendPackageVisible)
  console.log('noc_status updated: ready_for_erecord_review')
  console.log('erecord.status: ready_to_send')
  console.log('Output dir: ' + result.outputDir)
}

main().catch(function(err) {
  if (err instanceof SendPackageSafetyError) {
    console.error('Safety violation:', err.message)
    process.exit(2)
  }
  console.error('Prepare eRecord package failed:', err.message)
  process.exit(1)
})
