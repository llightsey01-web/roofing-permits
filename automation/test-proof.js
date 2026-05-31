require('dotenv').config({ path: '.env.local' })
const { sendNocToProof } = require('../lib/proof/send-noc-to-proof')

async function testProof() {
  console.log('Testing Proof notarization automation...\n')

  const jobId = process.argv[2]
  if (!jobId) {
    console.error('Usage: node automation/test-proof.js <jobId>')
    process.exit(1)
  }

  const result = await sendNocToProof(jobId)
  console.log('\nResult:', result)
}

testProof().catch(function(err) {
  console.error(err.message)
  process.exit(1)
})