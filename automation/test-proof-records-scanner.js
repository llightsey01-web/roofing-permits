require('dotenv').config({ path: '.env.local' })
const readline = require('readline')
const { runProofRecordsScanner, printCompletedTransactions } = require('../lib/proof/records-scanner')

function parseArgs(argv) {
  var opts = {
    jobId: null,
    selectIndex: null,
    transactionId: null,
    listOnly: false,
    apply: false,
    download: false,
    manualOverride: false,
  }

  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--job-id' && argv[i + 1]) {
      opts.jobId = argv[i + 1]
      i++
    } else if (argv[i] === '--select' && argv[i + 1]) {
      opts.selectIndex = argv[i + 1]
      i++
    } else if (argv[i] === '--transaction-id' && argv[i + 1]) {
      opts.transactionId = argv[i + 1]
      i++
    } else if (argv[i] === '--list') {
      opts.listOnly = true
    } else if (argv[i] === '--apply') {
      opts.apply = true
      opts.download = true
    } else if (argv[i] === '--manual-override') {
      opts.manualOverride = true
    } else if (!argv[i].startsWith('--') && !opts.jobId) {
      opts.jobId = argv[i]
    }
  }

  return opts
}

function askQuestion(prompt) {
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(function(resolve) {
    rl.question(prompt, function(answer) {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  var opts = parseArgs(process.argv.slice(2))
  var defaultJobId = '766b067e-f776-47d7-883e-ded938b66ddf'

  console.log('Proof records scanner — inspect only, no send')
  console.log('================================================\n')

  if (!opts.listOnly && opts.apply && !opts.jobId) {
    opts.jobId = defaultJobId
  }

  if (opts.listOnly || (!opts.apply && !opts.selectIndex && !opts.transactionId)) {
    var listResult = await runProofRecordsScanner({ enrich: true, listOnly: true })
    if (!listResult.success) {
      console.error(listResult.reason || 'Scan failed')
      process.exit(1)
    }

    if (opts.listOnly) {
      console.log('\nList only — no job linked.')
      console.log('Output dir: ' + listResult.outputDir)
      return
    }

    if (!listResult.completedRows.length) {
      process.exit(0)
    }

    var answer = await askQuestion('Enter the number of the transaction to link to job ' + (opts.jobId || defaultJobId) + ': ')
    opts.selectIndex = answer
    opts.jobId = opts.jobId || defaultJobId
    opts.apply = true
    opts.download = true
  }

  if (opts.apply && !opts.jobId) {
    opts.jobId = defaultJobId
  }

  var result = await runProofRecordsScanner({
    enrich: true,
    jobId: opts.apply ? opts.jobId : null,
    selectIndex: opts.selectIndex,
    transactionId: opts.transactionId,
    download: opts.download,
    manualOverride: opts.manualOverride,
  })

  console.log('\nScanner output dir: ' + result.outputDir)

  if (result.selected) {
    console.log('Selected transaction: ' + result.selected.transactionId)
  }

  if (result.matchResult) {
    console.log('Match confidence: ' + result.matchResult.proof_match_confidence)
  }

  if (result.linkRejected) {
    console.log('\nLink rejected: ' + result.rejectionReason)
    console.log('Re-run with --manual-override to force link.')
  }

  if (result.download) {
    console.log('\nDownload result:')
    console.log(JSON.stringify(result.download, null, 2))
    if (result.download.complete) {
      console.log('\nNotarized NOC saved: ' + result.download.notarizedFilePath)
      console.log('noc_status: notarized')
    } else if (!result.download.complete) {
      console.log('\nTransaction linked but not complete yet: ' + (result.download.status && result.download.status.primaryStatus))
    }
  }
}

main().catch(function(err) {
  console.error('Scanner failed:', err.message)
  process.exit(1)
})
