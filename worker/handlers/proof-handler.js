// worker/handlers/proof-handler.js
// Proof.com send + completion check with retry / circuit breaker / audit

const path = require('path')

function requireLib(mod) {
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  try { return require(path.join(__dirname, '..', '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}

const { withRetry } = requireLib('lib/automation/retry.js')
const circuit = requireLib('lib/automation/circuit-breaker.js')
const { logRunAction, captureFailureForensics } = requireLib('lib/audit/run-logger.js')

async function handleProofSend(job, run, deps) {
  var supabase = deps.supabase
  var markRunComplete = deps.markRunComplete
  var sendNocToProof = deps.sendNocToProof
  var started = Date.now()

  await circuit.assertCircuitClosed('proof')
  await logRunAction({
    runId: run.id,
    jobId: job.id,
    companyId: job.company_id,
    action: 'proof_send_start',
    status: 'success',
    stepNumber: 1,
    stepName: 'proof_send',
  })

  try {
    var result = await withRetry(function () {
      return sendNocToProof(job.id, { headless: true, companyId: job.company_id || null })
    }, {
      maxAttempts: 3,
      delayMs: 2000,
      label: 'proof_send:' + job.id,
      onError: async function (err, attempt) {
        await logRunAction({
          runId: run.id,
          jobId: job.id,
          companyId: job.company_id,
          action: 'proof_send',
          status: 'retry',
          stepNumber: 1,
          stepName: 'proof_send',
          errorMessage: err.message,
          metadata: { attempt: attempt },
        })
        await circuit.recordFailure('proof', err)
      },
    })

    await circuit.recordSuccess('proof')
    await markRunComplete(run.id)
    await logRunAction({
      runId: run.id,
      jobId: job.id,
      companyId: job.company_id,
      action: 'proof_send',
      status: 'success',
      stepNumber: 1,
      stepName: 'proof_send',
      durationMs: Date.now() - started,
    })

    var { data: updatedJob } = await supabase
      .from('jobs')
      .select('job_specs')
      .eq('id', job.id)
      .single()

    var transactionId =
      (updatedJob && updatedJob.job_specs && updatedJob.job_specs.proof && updatedJob.job_specs.proof.transaction_id) ||
      (result && result.transactionId) ||
      null

    if (!transactionId) {
      return result
    }

    await supabase.from('automation_runs').insert({
      job_id: job.id,
      run_type: 'proof_check',
      run_status: 'queued',
      dependency_run_id: run.id,
      started_at: new Date().toISOString(),
      attempts: 0,
    })

    return result
  } catch (err) {
    await circuit.recordFailure('proof', err)
    var forensics = await captureFailureForensics({
      jobId: job.id,
      runId: run.id,
      companyId: job.company_id,
      error: err,
      stepNumber: 1,
      stepName: 'proof_send',
      page: deps.page || null,
    })
    err.forensics = forensics
    throw err
  }
}

async function handleProofCheck(job, run, deps) {
  var supabase = deps.supabase
  var markRunComplete = deps.markRunComplete
  var requeueRun = deps.requeueRun
  var runProofCompletionCheck = deps.runProofCompletionCheck

  await circuit.assertCircuitClosed('proof')

  try {
    var checkResult = await runProofCompletionCheck({
      jobId: job.id,
      headless: true,
      companyId: job.company_id || null,
    })
    var jobResult = (checkResult.results || [])[0]

    if (jobResult && jobResult.complete) {
      await circuit.recordSuccess('proof')
      await markRunComplete(run.id)
      await logRunAction({
        runId: run.id,
        jobId: job.id,
        companyId: job.company_id,
        action: 'proof_check',
        status: 'success',
        stepNumber: 2,
        stepName: 'proof_check',
      })
      await supabase.from('automation_runs').insert({
        job_id: job.id,
        run_type: 'erecord_prepare',
        run_status: 'queued',
        dependency_run_id: run.id,
        started_at: new Date().toISOString(),
        attempts: 0,
      })
      return { complete: true, jobResult: jobResult }
    }

    await logRunAction({
      runId: run.id,
      jobId: job.id,
      companyId: job.company_id,
      action: 'proof_check',
      status: 'retry',
      stepNumber: 2,
      stepName: 'proof_check',
      errorMessage: 'Proof not complete — requeue',
    })
    await requeueRun(run.id, run.attempts)
    return { complete: false, requeued: true }
  } catch (err) {
    await circuit.recordFailure('proof', err)
    await captureFailureForensics({
      jobId: job.id,
      runId: run.id,
      companyId: job.company_id,
      error: err,
      stepNumber: 2,
      stepName: 'proof_check',
      page: deps.page || null,
    })
    throw err
  }
}

module.exports = {
  handleProofSend,
  handleProofCheck,
}
