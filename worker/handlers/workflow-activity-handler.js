// worker/handlers/workflow-activity-handler.js
// Claims queued workflow_activities and ensures Railway automation_runs exist.
// Does not execute Playwright itself — existing handlers do that.

'use strict'

const path = require('path')

function requireLib(mod) {
  try { return require(path.join(__dirname, '..', mod)) } catch (e) {}
  try { return require(path.join(__dirname, '..', '..', mod)) } catch (e) {}
  throw new Error('Cannot resolve lib module: ' + mod)
}

/**
 * Process a batch of queued workflow_activities for this worker's run types.
 * @param {object} deps
 * @param {object} deps.supabase
 * @param {string[]} [deps.allowedRunTypes] — if set, only these activity_type values
 * @param {number} [deps.limit]
 */
async function processQueuedWorkflowActivities(deps) {
  var supabase = deps.supabase
  var allowed = deps.allowedRunTypes || null
  var limit = deps.limit != null ? deps.limit : 10

  var { createWorkflowBridge } = requireLib('lib/workflow/workflow-bridge.js')
  var { createWorkflowState } = requireLib('lib/workflow/workflow-state.js')
  var { ACTIVITY_STATUS } = requireLib('lib/workflow/constants.js')

  var state = createWorkflowState({ supabase: supabase })
  var bridge = createWorkflowBridge({ state: state })

  var query = supabase
    .from('workflow_activities')
    .select('*')
    .eq('status', ACTIVITY_STATUS.QUEUED)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (allowed && allowed.length) {
    query = query.in('activity_type', allowed)
  }

  var { data: activities, error } = await query
  if (error) {
    console.warn('[workflow-activity] list failed:', error.message)
    return { processed: 0, error: error.message }
  }

  var processed = 0
  var created = 0

  for (var i = 0; i < (activities || []).length; i++) {
    var activity = activities[i]

    // Claim
    var { data: claimed, error: claimErr } = await supabase
      .from('workflow_activities')
      .update({
        status: ACTIVITY_STATUS.CLAIMED,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activity.id)
      .eq('status', ACTIVITY_STATUS.QUEUED)
      .select('*')
      .maybeSingle()

    if (claimErr || !claimed) continue
    processed += 1

    try {
      var run = await state.getRun(activity.run_id)
      if (!run || !run.job_id) {
        await supabase
          .from('workflow_activities')
          .update({
            status: ACTIVITY_STATUS.FAILED,
            error_message: 'missing workflow run / job_id',
            updated_at: new Date().toISOString(),
          })
          .eq('id', activity.id)
        continue
      }

      if (activity.legacy_run_id) {
        // Ensure legacy row is queued for Railway workers
        await supabase
          .from('automation_runs')
          .update({
            run_status: 'queued',
            started_at: new Date().toISOString(),
          })
          .eq('id', activity.legacy_run_id)
          .in('run_status', ['error'])
      } else {
        var legacy = await bridge.enqueueLegacyAutomationRun({
          jobId: run.job_id,
          runType: activity.activity_type,
          workflowRunId: run.id,
          workflowStepId: activity.step_id,
          workflowActivityId: activity.id,
          payload: Object.assign({}, activity.payload || {}, {
            source: 'workflow_activity_handler',
          }),
        })
        created += 1
        console.log(
          '[workflow-activity] enqueued',
          activity.activity_type,
          'legacy=',
          legacy.id,
          'activity=',
          activity.id
        )
      }

      await supabase
        .from('workflow_activities')
        .update({
          status: ACTIVITY_STATUS.RUNNING,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activity.id)
    } catch (err) {
      console.warn('[workflow-activity] failed:', err.message)
      await supabase
        .from('workflow_activities')
        .update({
          status: ACTIVITY_STATUS.QUEUED,
          error_message: err.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activity.id)
    }
  }

  return { processed: processed, created: created }
}

module.exports = {
  processQueuedWorkflowActivities: processQueuedWorkflowActivities,
}
