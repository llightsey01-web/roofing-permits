// worker/handlers/noc-handler.js
// Handles noc_generate runs, including contractor NOC workflow options

const path = require('path')

function requireLib(mod) {
  // Docker image layout: /app/handlers + /app/lib
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  // Local repo layout: worker/handlers + <repo>/lib
  try { return require(path.join(__dirname, '..', '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}

const { NOC_OPTIONS } = requireLib('lib/noc/noc-options.js')
const { withRetry } = requireLib('lib/automation/retry.js')
const { logRunAction, captureFailureForensics } = requireLib('lib/audit/run-logger.js')

async function queueRun(supabase, jobId, runType, dependencyRunId) {
  var { data: run, error } = await supabase.from('automation_runs').insert({
    job_id: jobId,
    run_type: runType,
    run_status: 'queued',
    dependency_run_id: dependencyRunId || null,
    started_at: new Date().toISOString(),
    attempts: 0,
  }).select('id, run_type, job_id').single()

  if (error) throw new Error('Failed to queue ' + runType + ': ' + error.message)
  return run
}

/**
 * @param {object} job
 * @param {object} run
 * @param {object} deps
 */
async function handleNocGenerate(job, run, deps) {
  var supabase = deps.supabase
  var markRunComplete = deps.markRunComplete
  var runNocPhaseForJob = deps.runNocPhaseForJob
  var jobId = job.id
  var nocOption = job.noc_option || NOC_OPTIONS.AUTO_GENERATE
  var started = Date.now()

  await logRunAction({
    runId: run.id,
    jobId: jobId,
    companyId: job.company_id,
    action: 'noc_generate_start',
    status: 'success',
    stepNumber: 1,
    stepName: 'noc_generate',
    metadata: { noc_option: nocOption },
  })

  try {
    if (nocOption === NOC_OPTIONS.UPLOAD_SIGNED) {
      console.log('[noc] Contractor uploaded signed NOC — skipping generation, queuing proof_send')
      if (!job.noc_file_path) {
        throw new Error('upload_signed requires noc_file_path (uploaded NOC missing)')
      }
      await supabase.from('jobs').update({
        noc_status: 'queued_for_notarization',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId)
      await markRunComplete(run.id)
      await queueRun(supabase, jobId, 'proof_send', run.id)
      await logRunAction({
        runId: run.id, jobId: jobId, companyId: job.company_id,
        action: 'noc_skip_to_proof', status: 'success', stepNumber: 1, stepName: 'noc_generate',
        durationMs: Date.now() - started,
      })
      return { skippedGeneration: true, next: 'proof_send' }
    }

    if (nocOption === NOC_OPTIONS.UPLOAD_NOTARIZED) {
      console.log('[noc] Contractor uploaded notarized NOC — skipping to ePN recording')
      var notarizedPath = job.job_specs && job.job_specs.proof
        ? job.job_specs.proof.notarized_file_path
        : null
      if (!notarizedPath) {
        throw new Error('upload_notarized requires job_specs.proof.notarized_file_path')
      }
      await supabase.from('jobs').update({
        noc_status: 'queued_for_erecord',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId)
      await markRunComplete(run.id)
      await queueRun(supabase, jobId, 'erecord_prepare', run.id)
      return { skippedGeneration: true, next: 'erecord_prepare' }
    }

    if (nocOption === NOC_OPTIONS.UPLOAD_RECORDED) {
      console.log('[noc] Contractor uploaded recorded NOC — skipping to permit')
      await supabase.from('jobs').update({
        noc_status: 'recorded',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId)
      await markRunComplete(run.id)
      await queueRun(supabase, jobId, 'permit_phase_1', run.id)
      return { skippedGeneration: true, next: 'permit_phase_1' }
    }

    if (nocOption === NOC_OPTIONS.MANUAL_DOWNLOAD) {
      console.log('[noc] Generating NOC for manual download')
      var result = await withRetry(function () {
        return runNocPhaseForJob(jobId, { currentRunId: run.id })
      }, {
        maxAttempts: 3,
        delayMs: 2000,
        label: 'noc_manual:' + jobId,
        onError: async function (err, attempt) {
          await logRunAction({
            runId: run.id, jobId: jobId, companyId: job.company_id,
            action: 'noc_generate', status: 'retry', stepNumber: 1, stepName: 'noc_generate',
            errorMessage: err.message, metadata: { attempt: attempt },
          })
        },
      })
      await supabase.from('jobs').update({
        noc_status: 'ready_for_download',
        updated_at: new Date().toISOString(),
      }).eq('id', jobId)
      await markRunComplete(run.id)
      await logRunAction({
        runId: run.id, jobId: jobId, companyId: job.company_id,
        action: 'noc_generate', status: 'success', stepNumber: 1, stepName: 'noc_generate',
        durationMs: Date.now() - started, metadata: { mode: 'manual_download' },
      })
      return { manualDownload: true, result: result }
    }

    console.log('[noc] auto_generate — running NOC generation then queuing proof_send')
    var autoResult = await withRetry(function () {
      return runNocPhaseForJob(jobId, { currentRunId: run.id })
    }, {
      maxAttempts: 3,
      delayMs: 2000,
      label: 'noc_auto:' + jobId,
      onError: async function (err, attempt) {
        await logRunAction({
          runId: run.id, jobId: jobId, companyId: job.company_id,
          action: 'noc_generate', status: 'retry', stepNumber: 1, stepName: 'noc_generate',
          errorMessage: err.message, metadata: { attempt: attempt },
        })
      },
    })
    await markRunComplete(run.id)
    await queueRun(supabase, jobId, 'proof_send', run.id)
    await logRunAction({
      runId: run.id, jobId: jobId, companyId: job.company_id,
      action: 'noc_generate', status: 'success', stepNumber: 1, stepName: 'noc_generate',
      durationMs: Date.now() - started,
    })
    console.log('[noc] Queued proof_send for job ' + jobId)
    return autoResult
  } catch (err) {
    await captureFailureForensics({
      jobId: jobId,
      runId: run.id,
      companyId: job.company_id,
      error: err,
      stepNumber: 1,
      stepName: 'noc_generate',
      page: deps.page || null,
    })
    throw err
  }
}

module.exports = {
  handleNocGenerate,
  queueRun,
}
