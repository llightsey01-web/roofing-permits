// lib/automation/permit-packet.js
// ZIG-8: stubbed permit_packet execution — durable path + atomic handoff only.
// No PDF fill, no packet assembly, no ahj_document_requirements changes.

'use strict'

var PERMIT_PACKET_RUN_TYPE = 'permit_packet'
var READY_STATUS = 'ready_for_physical_submission'
var PHYSICAL_SUBMISSION = 'physical_submission'

/**
 * Call the atomic DB RPC that sets job_status and ensures one pending action.
 * Worker-only. Never marks job_actions completed / never writes completed_by.
 *
 * @param {object} supabase — service-role client
 * @param {string} jobId
 * @returns {Promise<object>} RPC payload
 */
async function completePermitPacketSkeleton(supabase, jobId) {
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('completePermitPacketSkeleton: supabase client with rpc() is required')
  }
  if (!jobId) {
    throw new Error('completePermitPacketSkeleton: jobId is required')
  }

  var result = await supabase.rpc('complete_permit_packet_skeleton', {
    p_job_id: jobId,
  })

  if (result.error) {
    throw Object.assign(
      new Error('permit_packet atomic transition failed: ' + result.error.message),
      { errorCode: 'permit_packet_transition_failed', cause: result.error }
    )
  }

  var data = result.data
  if (!data || data.job_status !== READY_STATUS || !data.action_id) {
    throw new Error('permit_packet atomic transition returned unexpected payload')
  }

  return data
}

/**
 * Stub permit_packet run: atomic ready_for_physical_submission + pending action,
 * then mark the automation_run terminal (no Playwright).
 *
 * @param {object} supabase
 * @param {object} job
 * @param {object} runRecord
 */
async function runPermitPacketSkeleton(supabase, job, runRecord) {
  if (!job || !job.id) {
    throw new Error('runPermitPacketSkeleton: job is required')
  }
  if (!job.company_id) {
    throw new Error('runPermitPacketSkeleton: job.company_id is required (server-derived)')
  }

  var runId = runRecord && runRecord.id ? runRecord.id : null
  var transition = await completePermitPacketSkeleton(supabase, job.id)

  if (runId) {
    // needs_review is a valid automation_runs.run_status (portal success uses it for handoff).
    var update = await supabase
      .from('automation_runs')
      .update({
        run_status: 'needs_review',
        completed_at: new Date().toISOString(),
        last_completed_step: PERMIT_PACKET_RUN_TYPE,
        checkpoint_data: {
          zig8_skeleton: true,
          job_status: READY_STATUS,
          action_id: transition.action_id,
          action_created: transition.action_created === true,
        },
      })
      .eq('id', runId)

    if (update.error) {
      throw new Error('permit_packet run finalize failed: ' + update.error.message)
    }
  }

  return {
    jobId: job.id,
    companyId: transition.company_id,
    actionId: transition.action_id,
    actionCreated: transition.action_created === true,
    jobStatus: READY_STATUS,
    actionType: PHYSICAL_SUBMISSION,
    // Explicit: worker never completes human actions.
    completedBy: null,
  }
}

/**
 * Static guard used by tests: worker packet module must not expose completion.
 */
function workerCanCompleteJobAction() {
  return false
}

module.exports = {
  PERMIT_PACKET_RUN_TYPE: PERMIT_PACKET_RUN_TYPE,
  READY_FOR_PHYSICAL_SUBMISSION: READY_STATUS,
  PHYSICAL_SUBMISSION_ACTION_TYPE: PHYSICAL_SUBMISSION,
  completePermitPacketSkeleton: completePermitPacketSkeleton,
  runPermitPacketSkeleton: runPermitPacketSkeleton,
  workerCanCompleteJobAction: workerCanCompleteJobAction,
}
