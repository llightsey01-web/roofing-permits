// worker/handlers/polk-handler.js
// Polk County permit portal runs with retry / circuit breaker / audit

const path = require('path')

function requireLib(mod) {
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  try { return require(path.join(__dirname, '..', '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}

const { withRetry } = requireLib('lib/automation/retry.js')
const circuit = requireLib('lib/automation/circuit-breaker.js')
const { logRunAction, captureFailureForensics } = requireLib('lib/audit/run-logger.js')

/**
 * Wrap a permit portal workflow execution.
 * @param {object} job
 * @param {object} run
 * @param {object} deps
 * @param {Function} deps.runPermitWorkflow — async (job, runId) => void
 */
async function handlePolkPermit(job, run, deps) {
  var runPermitWorkflow = deps.runPermitWorkflow
  var service = 'polk'
  var started = Date.now()

  // Allow lee jobs to use same wrapper with different circuit key
  if (deps.serviceKey) service = deps.serviceKey

  await circuit.assertCircuitClosed(service)
  await logRunAction({
    runId: run.id,
    jobId: job.id,
    companyId: job.company_id,
    action: 'permit_start',
    status: 'success',
    stepNumber: 1,
    stepName: run.run_type || 'permit_phase_1',
    metadata: {
      resume_from_step: run.payload && run.payload.resume_from_step ? run.payload.resume_from_step : null,
    },
  })

  try {
    var result = await withRetry(function () {
      return runPermitWorkflow(job, run.id)
    }, {
      maxAttempts: 2,
      delayMs: 3000,
      label: service + '_permit:' + job.id,
      onError: async function (err, attempt) {
        await logRunAction({
          runId: run.id,
          jobId: job.id,
          companyId: job.company_id,
          action: 'permit_workflow',
          status: 'retry',
          stepNumber: 1,
          stepName: run.run_type || 'permit',
          errorMessage: err.message,
          metadata: { attempt: attempt },
        })
        await circuit.recordFailure(service, err)
      },
    })

    await circuit.recordSuccess(service)
    await logRunAction({
      runId: run.id,
      jobId: job.id,
      companyId: job.company_id,
      action: 'permit_workflow',
      status: 'success',
      stepNumber: 1,
      stepName: run.run_type || 'permit',
      durationMs: Date.now() - started,
    })
    return result
  } catch (err) {
    await circuit.recordFailure(service, err)
    await captureFailureForensics({
      jobId: job.id,
      runId: run.id,
      companyId: job.company_id,
      error: err,
      stepNumber: 1,
      stepName: run.run_type || 'permit',
      page: deps.page || null,
    })
    throw err
  }
}

module.exports = {
  handlePolkPermit,
}
