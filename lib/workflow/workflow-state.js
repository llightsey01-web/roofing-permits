'use strict'

const { createClient } = require('@supabase/supabase-js')
var constants = require('./constants.js')
var idempotency = require('./workflow-idempotency.js')

function createSupabase(client) {
  if (client) return client
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('workflow-state: Supabase env not configured')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function createWorkflowState(options) {
  var opts = options || {}
  var supabase = createSupabase(opts.supabase)

  async function getWorkflowDefinition(workflowKey, version) {
    var query = supabase
      .from('workflows')
      .select('*')
      .eq('key', workflowKey)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)

    if (version != null) {
      query = supabase
        .from('workflows')
        .select('*')
        .eq('key', workflowKey)
        .eq('version', version)
        .limit(1)
    }

    var { data, error } = await query.maybeSingle()
    if (error) throw new Error('getWorkflowDefinition: ' + error.message)
    return data
  }

  async function createRun(input) {
    var i = input || {}
    if (!i.workflowKey) throw new Error('createRun: workflowKey required')

    var definition = await getWorkflowDefinition(i.workflowKey, i.workflowVersion)
    if (!definition) throw new Error('createRun: workflow not found: ' + i.workflowKey)

    var idempotencyKey =
      i.idempotencyKey ||
      idempotency.workflowRunKey({
        workflowKey: definition.key,
        workflowVersion: definition.version,
        jobId: i.jobId,
        companyId: i.companyId,
        scope: i.scope || 'default',
      })

    var row = {
      workflow_id: definition.id,
      workflow_key: definition.key,
      workflow_version: definition.version,
      job_id: i.jobId || null,
      company_id: i.companyId || null,
      trigger_run_id: i.triggerRunId || null,
      legacy_run_id: i.legacyRunId || null,
      status: i.status || constants.RUN_STATUS.QUEUED,
      current_step_key: i.currentStepKey || null,
      idempotency_key: idempotencyKey,
      input: i.input || {},
      output: i.output || {},
      created_by: i.createdBy || null,
    }

    var { data, error } = await supabase
      .from('workflow_runs')
      .upsert(row, { onConflict: 'idempotency_key' })
      .select('*')
      .single()

    if (error) throw new Error('createRun: ' + error.message)
    return data
  }

  async function getRun(runId) {
    var { data, error } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle()
    if (error) throw new Error('getRun: ' + error.message)
    return data
  }

  async function getRunByIdempotencyKey(key) {
    var { data, error } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle()
    if (error) throw new Error('getRunByIdempotencyKey: ' + error.message)
    return data
  }

  async function updateRun(runId, patch) {
    var updates = Object.assign({}, patch || {}, {
      updated_at: new Date().toISOString(),
    })
    var { data, error } = await supabase
      .from('workflow_runs')
      .update(updates)
      .eq('id', runId)
      .select('*')
      .single()
    if (error) throw new Error('updateRun: ' + error.message)
    return data
  }

  async function ensureStep(input) {
    var i = input || {}
    if (!i.runId || !i.stepKey) throw new Error('ensureStep: runId and stepKey required')

    var idempotencyKey =
      i.idempotencyKey ||
      idempotency.stepKey({ runId: i.runId, stepKey: i.stepKey })

    var row = {
      run_id: i.runId,
      step_key: i.stepKey,
      step_name: i.stepName || i.stepKey,
      step_type: i.stepType || constants.STEP_TYPE.ACTION,
      sequence_order: i.sequenceOrder != null ? i.sequenceOrder : 0,
      status: i.status || constants.STEP_STATUS.PENDING,
      max_attempts: i.maxAttempts != null ? i.maxAttempts : constants.DEFAULT_MAX_ATTEMPTS,
      idempotency_key: idempotencyKey,
      input: i.input || {},
      timeout_ms: i.timeoutMs != null ? i.timeoutMs : null,
    }

    var { data, error } = await supabase
      .from('workflow_steps')
      .upsert(row, { onConflict: 'run_id,step_key' })
      .select('*')
      .single()

    if (error) throw new Error('ensureStep: ' + error.message)
    return data
  }

  async function getStep(runId, stepKey) {
    var { data, error } = await supabase
      .from('workflow_steps')
      .select('*')
      .eq('run_id', runId)
      .eq('step_key', stepKey)
      .maybeSingle()
    if (error) throw new Error('getStep: ' + error.message)
    return data
  }

  async function listSteps(runId) {
    var { data, error } = await supabase
      .from('workflow_steps')
      .select('*')
      .eq('run_id', runId)
      .order('sequence_order', { ascending: true })
    if (error) throw new Error('listSteps: ' + error.message)
    return data || []
  }

  async function updateStep(stepId, patch) {
    var updates = Object.assign({}, patch || {}, {
      updated_at: new Date().toISOString(),
    })
    var { data, error } = await supabase
      .from('workflow_steps')
      .update(updates)
      .eq('id', stepId)
      .select('*')
      .single()
    if (error) throw new Error('updateStep: ' + error.message)
    return data
  }

  async function appendStepHistory(entry) {
    var e = entry || {}
    var row = {
      run_id: e.runId,
      step_id: e.stepId,
      attempt_number: e.attemptNumber != null ? e.attemptNumber : 1,
      from_status: e.fromStatus || null,
      to_status: e.toStatus,
      event_type: e.eventType,
      message: e.message || null,
      payload: e.payload || {},
    }
    var { data, error } = await supabase
      .from('workflow_step_history')
      .insert(row)
      .select('*')
      .single()
    if (error) throw new Error('appendStepHistory: ' + error.message)
    return data
  }

  async function appendRetryHistory(entry) {
    var e = entry || {}
    var row = {
      run_id: e.runId,
      step_id: e.stepId,
      attempt_number: e.attemptNumber,
      delay_ms: e.delayMs != null ? e.delayMs : 0,
      error_message: e.errorMessage || null,
      error_code: e.errorCode || null,
      will_retry: e.willRetry !== false,
    }
    var { data, error } = await supabase
      .from('workflow_retry_history')
      .insert(row)
      .select('*')
      .single()
    if (error) throw new Error('appendRetryHistory: ' + error.message)
    return data
  }

  async function recordFailure(entry) {
    var e = entry || {}
    var row = {
      run_id: e.runId,
      step_id: e.stepId || null,
      failure_type: e.failureType || 'unknown',
      error_code: e.errorCode || null,
      error_message: e.errorMessage || 'Unknown failure',
      stack: e.stack || null,
      is_retryable: e.isRetryable !== false,
    }
    var { data, error } = await supabase
      .from('workflow_failures')
      .insert(row)
      .select('*')
      .single()
    if (error) throw new Error('recordFailure: ' + error.message)
    return data
  }

  async function recordManualOverride(entry) {
    var e = entry || {}
    var row = {
      run_id: e.runId,
      step_id: e.stepId || null,
      action: e.action,
      reason: e.reason || null,
      actor_user_id: e.actorUserId || null,
      payload: e.payload || {},
    }
    var { data, error } = await supabase
      .from('workflow_manual_overrides')
      .insert(row)
      .select('*')
      .single()
    if (error) throw new Error('recordManualOverride: ' + error.message)
    return data
  }

  async function enqueueActivity(input) {
    var i = input || {}
    if (!i.runId || !i.stepId || !i.activityType) {
      throw new Error('enqueueActivity: runId, stepId, activityType required')
    }
    var idempotencyKey =
      i.idempotencyKey ||
      idempotency.activityKey({
        runId: i.runId,
        stepKey: i.stepKey || i.stepId,
        activityType: i.activityType,
        attempt: i.attempt || 1,
      })

    var row = {
      run_id: i.runId,
      step_id: i.stepId,
      activity_type: i.activityType,
      status: constants.ACTIVITY_STATUS.QUEUED,
      idempotency_key: idempotencyKey,
      payload: i.payload || {},
      legacy_run_id: i.legacyRunId || null,
    }

    var { data, error } = await supabase
      .from('workflow_activities')
      .upsert(row, { onConflict: 'idempotency_key' })
      .select('*')
      .single()

    if (error) throw new Error('enqueueActivity: ' + error.message)
    return data
  }

  return {
    supabase: supabase,
    getWorkflowDefinition: getWorkflowDefinition,
    createRun: createRun,
    getRun: getRun,
    getRunByIdempotencyKey: getRunByIdempotencyKey,
    updateRun: updateRun,
    ensureStep: ensureStep,
    getStep: getStep,
    listSteps: listSteps,
    updateStep: updateStep,
    appendStepHistory: appendStepHistory,
    appendRetryHistory: appendRetryHistory,
    recordFailure: recordFailure,
    recordManualOverride: recordManualOverride,
    enqueueActivity: enqueueActivity,
  }
}

module.exports = {
  createWorkflowState: createWorkflowState,
  createSupabase: createSupabase,
}
