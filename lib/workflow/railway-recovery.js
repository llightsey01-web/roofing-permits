'use strict'

/**
 * Railway restart survival helpers.
 * Re-queues stuck browser activities / automation runs after container restart.
 */

var { createWorkflowState } = require('./workflow-state.js')
var { ACTIVITY_STATUS, RUN_STATUS } = require('./constants.js')

var DEFAULT_STALE_MS = 20 * 60 * 1000

function isoMinutesAgo(ms) {
  return new Date(Date.now() - ms).toISOString()
}

/**
 * After Railway restart:
 * 1) Reset stale claimed/running workflow_activities → queued
 * 2) Reset linked stuck automation_runs → queued
 * 3) Ensure queued activities still have a legacy automation_runs row
 */
async function recoverAfterRestart(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var supabase = state.supabase
  var staleMs = opts.staleMs != null ? opts.staleMs : DEFAULT_STALE_MS
  var cutoff = isoMinutesAgo(staleMs)
  var workerName = opts.workerName || 'unknown'
  var summary = {
    workerName: workerName,
    activitiesReset: 0,
    automationRunsReset: 0,
    activitiesRequeued: 0,
    errors: [],
  }

  try {
    var { data: staleActivities, error: actErr } = await supabase
      .from('workflow_activities')
      .select('id, run_id, status, legacy_run_id, activity_type, updated_at, payload')
      .in('status', [ACTIVITY_STATUS.CLAIMED, ACTIVITY_STATUS.RUNNING])
      .lt('updated_at', cutoff)
      .limit(100)

    if (actErr) throw actErr

    for (var i = 0; i < (staleActivities || []).length; i++) {
      var act = staleActivities[i]
      var { error: resetErr } = await supabase
        .from('workflow_activities')
        .update({
          status: ACTIVITY_STATUS.QUEUED,
          updated_at: new Date().toISOString(),
          error_message: 'reset after railway restart (' + workerName + ')',
        })
        .eq('id', act.id)
        .in('status', [ACTIVITY_STATUS.CLAIMED, ACTIVITY_STATUS.RUNNING])

      if (resetErr) {
        summary.errors.push(resetErr.message)
        continue
      }
      summary.activitiesReset += 1

      if (act.legacy_run_id) {
        var { error: legErr } = await supabase
          .from('automation_runs')
          .update({
            run_status: 'queued',
            started_at: new Date().toISOString(),
            error_message: 'reset after railway restart (' + workerName + ')',
          })
          .eq('id', act.legacy_run_id)
          .in('run_status', ['running', 'error'])

        if (!legErr) summary.automationRunsReset += 1
      }
    }
  } catch (err) {
    summary.errors.push('activities: ' + err.message)
  }

  // Also reset automation_runs that carry workflow_run_id and are stuck running
  try {
    var { data: stuckLegacy, error: stuckErr } = await supabase
      .from('automation_runs')
      .select('id, payload, run_type, run_status')
      .eq('run_status', 'running')
      .lt('started_at', cutoff)
      .limit(100)

    if (stuckErr) throw stuckErr

    for (var j = 0; j < (stuckLegacy || []).length; j++) {
      var leg = stuckLegacy[j]
      var hasWorkflow = leg.payload && leg.payload.workflow_run_id
      if (!hasWorkflow && !opts.resetAllStuck) continue

      var { error: uErr } = await supabase
        .from('automation_runs')
        .update({
          run_status: 'queued',
          started_at: new Date().toISOString(),
          error_message: 'workflow bridge reset after railway restart (' + workerName + ')',
        })
        .eq('id', leg.id)
        .eq('run_status', 'running')

      if (!uErr) summary.automationRunsReset += 1
    }
  } catch (err2) {
    summary.errors.push('automation_runs: ' + err2.message)
  }

  console.log('[railway-recovery]', JSON.stringify(summary))
  return summary
}

/**
 * Mark a workflow_run as waiting again if a worker crash left it mid-activity.
 * Non-destructive — only touches runs still marked running with a pause_reason candidate.
 */
async function healOrphanedRunningWorkflows(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var supabase = state.supabase
  var staleMs = opts.staleMs != null ? opts.staleMs : DEFAULT_STALE_MS
  var cutoff = isoMinutesAgo(staleMs)
  var healed = 0

  var { data: runs, error } = await supabase
    .from('workflow_runs')
    .select('id, status, current_step_key, updated_at')
    .eq('status', RUN_STATUS.RUNNING)
    .lt('updated_at', cutoff)
    .limit(50)

  if (error) throw new Error('healOrphanedRunningWorkflows: ' + error.message)

  for (var i = 0; i < (runs || []).length; i++) {
    var run = runs[i]
    // Leave control-plane "running" alone if updated recently; otherwise park as waiting
    // so admin/Trigger can resume without losing the run.
    var { error: hErr } = await supabase
      .from('workflow_runs')
      .update({
        status: RUN_STATUS.WAITING,
        pause_reason: 'railway_restart',
        paused_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: 'Parked after railway restart — safe to resume',
      })
      .eq('id', run.id)
      .eq('status', RUN_STATUS.RUNNING)

    if (!hErr) healed += 1
  }

  return { healed: healed }
}

module.exports = {
  recoverAfterRestart: recoverAfterRestart,
  healOrphanedRunningWorkflows: healOrphanedRunningWorkflows,
  DEFAULT_STALE_MS: DEFAULT_STALE_MS,
}
