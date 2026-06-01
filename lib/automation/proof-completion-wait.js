// lib/automation/proof-completion-wait.js
// Proof completion polling — kept separate so API routes do not trace lib/proof/completion.js

const { runProofCompletionCheck } = require('../proof/completion')

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

async function waitForProofCompletionAndContinue(jobId, options) {
  var opts = options || {}
  var maxWaitMs = opts.maxWaitMs || parseInt(process.env.PROOF_COMPLETION_MAX_WAIT_MS || '1800000', 10)
  var pollMs = opts.pollIntervalMs || parseInt(process.env.PROOF_COMPLETION_POLL_MS || '60000', 10)
  var deadline = Date.now() + maxWaitMs
  var attempts = 0
  var lastResult = null

  console.log('Waiting for Proof notarization (max ' + Math.round(maxWaitMs / 60000) + ' min, poll every ' + Math.round(pollMs / 1000) + 's)...')

  while (Date.now() < deadline) {
    attempts++
    var checkResult = await runProofCompletionCheck({
      jobId: jobId,
      headless: true,
      slowMo: opts.slowMo,
      outputDir: opts.outputDir ? require('path').join(opts.outputDir, 'proof-completion-' + attempts) : undefined,
    })

    if (checkResult.skipped) {
      return {
        complete: false,
        skipped: true,
        reason: checkResult.reason,
        stoppingPoint: 'proof_completion_skipped',
        attempts: attempts,
      }
    }

    var jobResult = (checkResult.results || [])[0] || null
    lastResult = jobResult

    if (jobResult && jobResult.complete) {
      return {
        complete: true,
        attempts: attempts,
        jobResult: jobResult,
        erecordPrepResult: jobResult.erecordPrepResult || null,
        erecordPrepError: jobResult.erecordPrepError || null,
        stoppingPoint: jobResult.erecordPrepResult
          ? 'ready_for_erecord_review'
          : (jobResult.erecordPrepError ? 'erecord_prepare_failed' : 'queued_for_erecord'),
        nocStatus: jobResult.nocStatus,
        notarizedFilePath: jobResult.notarizedFilePath,
      }
    }

    if (jobResult && jobResult.skipped) {
      return {
        complete: false,
        skipped: true,
        reason: jobResult.reason,
        stoppingPoint: 'proof_completion_skipped',
        attempts: attempts,
      }
    }

    var remaining = deadline - Date.now()
    if (remaining <= 0) break

    console.log('Proof not complete yet (attempt ' + attempts + ') — next poll in ' + Math.round(pollMs / 1000) + 's')
    await sleep(Math.min(pollMs, remaining))
  }

  return {
    complete: false,
    timedOut: true,
    attempts: attempts,
    lastResult: lastResult,
    stoppingPoint: 'waiting_for_proof',
  }
}

module.exports = {
  waitForProofCompletionAndContinue,
}
