'use strict'

/**
 * Phase 1 migration helpers — Proof→ePN handoff + legacy activity completion.
 */

var { isWorkflowEngineEpnEnabled } = require('./feature-flags.js')
var { createWorkflowEngine, EVENT_NAMES, RUN_STATUS, STEP_STATUS } = require('./index.js')

function requireEpnWorkflow() {
  return require('../../workflows/epn-workflow.js')
}

/**
 * Called when Proof is complete and WORKFLOW_ENGINE_EPN=true.
 * Starts durable ePN workflow instead of inserting legacy erecord_prepare alone.
 */
async function startEpnFromProofCompletion(input) {
  var i = input || {}
  if (!i.jobId) throw new Error('startEpnFromProofCompletion: jobId required')

  var { startEpnWorkflow } = requireEpnWorkflow()
  var result = await startEpnWorkflow({
    jobId: i.jobId,
    companyId: i.companyId,
    dependencyRunId: i.dependencyRunId,
    source: i.source || 'proof_check',
    useLegacyBridge: true,
    dryRun: Boolean(i.dryRun),
    input: i.input || {},
  })

  console.log(
    '[epn-migration] Started durable ePN workflow run=' +
      result.run.id +
      ' job=' +
      i.jobId +
      ' status=' +
      result.run.status
  )

  return result
}

/**
 * After legacy erecord_prepare / erecord_submit completes, sync workflow + resume.
 */
async function onLegacyErecordActivityComplete(input) {
  var i = input || {}
  if (!i.legacyRun) throw new Error('onLegacyErecordActivityComplete: legacyRun required')

  var legacy = i.legacyRun
  var payload = legacy.payload || {}
  var workflowRunId = i.workflowRunId || payload.workflow_run_id
  var activityId = i.workflowActivityId || payload.workflow_activity_id
  var success = i.success !== false

  if (!workflowRunId) {
    // Not a workflow-bridged run — ignore
    return { skipped: true, reason: 'no_workflow_run_id' }
  }

  var engine = i.engine || createWorkflowEngine()
  var bridge = engine.bridge

  await bridge.syncLegacyRunCompletion({
    legacyRunId: legacy.id,
    workflowRunId: workflowRunId,
    workflowActivityId: activityId,
  })

  var run = await engine.state.getRun(workflowRunId)
  if (!run) return { skipped: true, reason: 'workflow_run_missing' }

  if (!success) {
    await engine.events.emitEvent({
      eventName: EVENT_NAMES.ACTIVITY_FAILED,
      runId: workflowRunId,
      jobId: run.job_id,
      companyId: run.company_id,
      source: 'worker',
      externalId: 'legacy_fail:' + legacy.id,
      payload: {
        legacyRunId: legacy.id,
        runType: legacy.run_type,
        error: i.errorMessage || legacy.error_message || null,
      },
    })
    await engine.state.updateRun(workflowRunId, {
      status: RUN_STATUS.FAILED,
      error_message: i.errorMessage || legacy.error_message || 'ePN activity failed',
    })
    return { ok: false, runId: workflowRunId }
  }

  var eventName =
    legacy.run_type === 'erecord_prepare'
      ? EVENT_NAMES.ERECORD_PREPARE_COMPLETED
      : legacy.run_type === 'erecord_submit'
        ? EVENT_NAMES.ERECORD_SUBMITTED
        : EVENT_NAMES.ACTIVITY_COMPLETED

  await engine.events.emitEvent({
    eventName: eventName,
    runId: workflowRunId,
    jobId: run.job_id,
    companyId: run.company_id,
    source: 'worker',
    externalId: 'legacy_ok:' + legacy.id,
    payload: {
      legacyRunId: legacy.id,
      runType: legacy.run_type,
      result: i.result || {},
    },
  })

  await engine.events.emitEvent({
    eventName: EVENT_NAMES.ACTIVITY_COMPLETED,
    runId: workflowRunId,
    jobId: run.job_id,
    companyId: run.company_id,
    source: 'worker',
    externalId: 'activity_ok:' + legacy.id,
    payload: {
      legacyRunId: legacy.id,
      runType: legacy.run_type,
      activityId: activityId,
    },
  })

  // Resume workflow past the waiting activity step
  var { resumeEpnWorkflow } = requireEpnWorkflow()
  var resumed = await resumeEpnWorkflow(workflowRunId, {
    engine: engine,
    reason: 'legacy activity complete: ' + legacy.run_type,
    source: 'worker',
    completeCurrentStep: true,
    stepOutput: {
      legacyRunId: legacy.id,
      runType: legacy.run_type,
      result: i.result || {},
    },
    useLegacyBridge: true,
  })

  console.log(
    '[epn-migration] Resumed ePN workflow run=' +
      workflowRunId +
      ' after ' +
      legacy.run_type +
      ' → status=' +
      (resumed && resumed.status)
  )

  return { ok: true, run: resumed }
}

/**
 * If job is ready_for_erecord_review and workflow is paused on wait_review,
 * allow approve via event.
 */
async function findOpenEpnRunForJob(jobId) {
  var engine = createWorkflowEngine()
  var { data, error } = await engine.state.supabase
    .from('workflow_runs')
    .select('*')
    .eq('job_id', jobId)
    .eq('workflow_key', 'epn')
    .in('status', [RUN_STATUS.WAITING, RUN_STATUS.PAUSED, RUN_STATUS.RUNNING, RUN_STATUS.QUEUED])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

module.exports = {
  isWorkflowEngineEpnEnabled: isWorkflowEngineEpnEnabled,
  startEpnFromProofCompletion: startEpnFromProofCompletion,
  onLegacyErecordActivityComplete: onLegacyErecordActivityComplete,
  findOpenEpnRunForJob: findOpenEpnRunForJob,
  EVENT_NAMES: EVENT_NAMES,
  STEP_STATUS: STEP_STATUS,
}
