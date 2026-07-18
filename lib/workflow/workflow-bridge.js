'use strict'

/**
 * Bridge between durable workflow engine and legacy automation_runs.
 * Existing workers keep working; Phase migrations can link both systems.
 */
function createWorkflowBridge(options) {
  var opts = options || {}
  var state = opts.state
  if (!state) {
    state = require('./workflow-state.js').createWorkflowState({ supabase: opts.supabase })
  }

  /**
   * Attach a legacy automation_runs id to a workflow run (non-destructive).
   */
  async function linkLegacyRun(runId, legacyRunId) {
    if (!runId || !legacyRunId) throw new Error('linkLegacyRun: runId and legacyRunId required')
    return state.updateRun(runId, { legacy_run_id: legacyRunId })
  }

  /**
   * Create a legacy automation_runs row for Playwright workers, linked to workflow activity.
   * Does not change worker claim logic — workers still poll automation_runs.
   */
  async function enqueueLegacyAutomationRun(input) {
    var i = input || {}
    if (!i.jobId || !i.runType) {
      throw new Error('enqueueLegacyAutomationRun: jobId and runType required')
    }

    var row = {
      job_id: i.jobId,
      run_type: i.runType,
      run_status: 'queued',
      attempts: 0,
      payload: Object.assign({}, i.payload || {}, {
        workflow_run_id: i.workflowRunId || null,
        workflow_step_id: i.workflowStepId || null,
        workflow_activity_id: i.workflowActivityId || null,
      }),
      started_at: new Date().toISOString(),
    }

    var { data, error } = await state.supabase
      .from('automation_runs')
      .insert(row)
      .select('*')
      .single()

    if (error) throw new Error('enqueueLegacyAutomationRun: ' + error.message)

    if (i.workflowRunId) {
      await state.updateRun(i.workflowRunId, { legacy_run_id: data.id })
    }

    if (i.workflowActivityId) {
      await state.supabase
        .from('workflow_activities')
        .update({
          legacy_run_id: data.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', i.workflowActivityId)
    }

    return data
  }

  /**
   * Map a completed legacy automation run back onto a workflow activity + event.
   */
  async function syncLegacyRunCompletion(input) {
    var i = input || {}
    if (!i.legacyRunId) throw new Error('syncLegacyRunCompletion: legacyRunId required')

    var { data: legacy, error } = await state.supabase
      .from('automation_runs')
      .select('*')
      .eq('id', i.legacyRunId)
      .maybeSingle()

    if (error) throw new Error('syncLegacyRunCompletion: ' + error.message)
    if (!legacy) return null

    var workflowRunId =
      i.workflowRunId ||
      (legacy.payload && legacy.payload.workflow_run_id) ||
      null
    var activityId =
      i.workflowActivityId ||
      (legacy.payload && legacy.payload.workflow_activity_id) ||
      null

    if (activityId) {
      var activityStatus =
        legacy.run_status === 'complete'
          ? 'succeeded'
          : legacy.run_status === 'error'
            ? 'failed'
            : 'running'

      await state.supabase
        .from('workflow_activities')
        .update({
          status: activityStatus,
          result: {
            legacy_run_status: legacy.run_status,
            error_message: legacy.error_message || null,
          },
          error_message: legacy.error_message || null,
          completed_at:
            legacy.run_status === 'complete' || legacy.run_status === 'error'
              ? new Date().toISOString()
              : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activityId)
    }

    return {
      legacy: legacy,
      workflowRunId: workflowRunId,
      activityId: activityId,
    }
  }

  return {
    linkLegacyRun: linkLegacyRun,
    enqueueLegacyAutomationRun: enqueueLegacyAutomationRun,
    syncLegacyRunCompletion: syncLegacyRunCompletion,
  }
}

module.exports = {
  createWorkflowBridge: createWorkflowBridge,
}
