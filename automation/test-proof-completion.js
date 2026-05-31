require('dotenv').config({ path: '.env.local' })
const { runProofCompletionCheck } = require('../lib/proof/completion')

async function main() {
  var jobId = process.argv[2]
  if (!jobId) {
    console.error('Usage: node automation/test-proof-completion.js <jobId>')
    process.exit(1)
  }

  console.log('Proof completion check for job ' + jobId)
  var result = await runProofCompletionCheck({ jobId: jobId, headless: false })

  console.log('\nResult:')
  console.log(JSON.stringify(result, null, 2))

  if (!result.success) {
    process.exit(1)
  }

  var jobResult = (result.results || [])[0]
  if (jobResult && jobResult.skipped) {
    console.log('\nSkipped: ' + jobResult.reason)
    process.exit(1)
  } else if (jobResult && jobResult.complete) {
    console.log('\nNotarized NOC saved: ' + jobResult.notarizedFilePath)
  } else if (jobResult && !jobResult.complete) {
    console.log('\nNot complete yet — status: ' + ((jobResult.status && jobResult.status.primaryStatus) || 'unknown'))
  }
}

main().catch(function(err) {
  console.error('Proof completion check failed:', err.message)
  process.exit(1)
})
