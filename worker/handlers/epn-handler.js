// worker/handlers/epn-handler.js
// ePN prepare / submit with retry / circuit breaker / audit

const path = require('path')

function requireLib(mod) {
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  try { return require(path.join(__dirname, '..', '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}

const { withRetry } = requireLib('lib/automation/retry.js')
const circuit = requireLib('lib/automation/circuit-breaker.js')
const { logRunAction, captureFailureForensics } = requireLib('lib/audit/run-logger.js')

async function handleErecordPrepare(job, run, deps) {
  var markRunComplete = deps.markRunComplete
  var prepareRecordingPackage = deps.prepareRecordingPackage
  var started = Date.now()

  await circuit.assertCircuitClosed('epn')
  await logRunAction({
    runId: run.id,
    jobId: job.id,
    companyId: job.company_id,
    action: 'erecord_prepare_start',
    status: 'success',
    stepNumber: 1,
    stepName: 'erecord_prepare',
  })

  try {
    var prepResult = await withRetry(function () {
      return prepareRecordingPackage(job.id, {
        headless: true,
        companyId: job.company_id || null,
      })
    }, {
      maxAttempts: 3,
      delayMs: 2500,
      label: 'erecord_prepare:' + job.id,
      onError: async function (err, attempt) {
        await logRunAction({
          runId: run.id,
          jobId: job.id,
          companyId: job.company_id,
          action: 'erecord_prepare',
          status: 'retry',
          stepNumber: 1,
          stepName: 'erecord_prepare',
          errorMessage: err.message,
          metadata: { attempt: attempt },
        })
        await circuit.recordFailure('epn', err)
      },
    })

    await circuit.recordSuccess('epn')
    await markRunComplete(run.id)
    await logRunAction({
      runId: run.id,
      jobId: job.id,
      companyId: job.company_id,
      action: 'erecord_prepare',
      status: 'success',
      stepNumber: 1,
      stepName: 'erecord_prepare',
      durationMs: Date.now() - started,
    })

    // Notify durable ePN workflow if this run was bridged from it
    try {
      var epnMigration = requireLib('lib/workflow/epn-migration.js')
      if (epnMigration.isWorkflowEngineEpnEnabled() || (run.payload && run.payload.workflow_run_id)) {
        await epnMigration.onLegacyErecordActivityComplete({
          legacyRun: run,
          job: job,
          result: prepResult || {},
        })
      }
    } catch (wfErr) {
      console.warn('[epn-handler] workflow sync failed (non-fatal):', wfErr.message)
    }

    return prepResult
  } catch (err) {
    await circuit.recordFailure('epn', err)
    await captureFailureForensics({
      jobId: job.id,
      runId: run.id,
      companyId: job.company_id,
      error: err,
      stepNumber: 1,
      stepName: 'erecord_prepare',
      page: deps.page || null,
    })

    // Persist error before workflow sync so run_status is authoritative.
    await markRunComplete(run.id, {
      run_status: 'error',
      error_message: err.message,
    })

    try {
      var epnMigrationFail = requireLib('lib/workflow/epn-migration.js')
      if (run.payload && run.payload.workflow_run_id) {
        await epnMigrationFail.onLegacyErecordActivityComplete({
          legacyRun: run,
          job: job,
          errorMessage: err.message,
        })
      }
    } catch (wfErr2) {
      console.warn('[epn-handler] workflow fail sync error:', wfErr2.message)
    }

    throw err
  }
}

async function handleErecordSubmit(job, run, deps) {
  var markRunComplete = deps.markRunComplete
  var logAction = deps.logRunAction || logRunAction
  // run_actions.status has no intervention value (success/retry/failure only).
  // Keep the existing field; metadata records that this is not a legal e-record.
  await logAction({
    runId: run.id,
    jobId: job.id,
    companyId: job.company_id,
    action: 'erecord_submit',
    status: 'success',
    stepNumber: 1,
    stepName: 'erecord_submit',
    metadata: {
      skipped: true,
      reason: 'not_implemented',
      outcome: 'intervention',
      legal_submission: false,
    },
  })
  await markRunComplete(run.id, { run_status: 'needs_review' })

  try {
    var onComplete = deps.onLegacyErecordActivityComplete
    if (!onComplete) {
      var epnMigrationSubmit = requireLib('lib/workflow/epn-migration.js')
      onComplete = function (input) {
        return epnMigrationSubmit.onLegacyErecordActivityComplete(input)
      }
    }
    if (run.payload && run.payload.workflow_run_id) {
      await onComplete({
        legacyRun: run,
        job: job,
        result: {
          skipped: true,
          reason: 'erecord_submit not implemented',
          needsReview: true,
          outcome: 'intervention',
          legal_submission: false,
        },
      })
    }
  } catch (wfErr3) {
    console.warn('[epn-handler] submit workflow sync failed:', wfErr3.message)
  }

  return {
    skipped: true,
    reason: 'erecord_submit not implemented',
    outcome: 'intervention',
    legal_submission: false,
  }
}

module.exports = {
  handleErecordPrepare,
  handleErecordSubmit,
}
