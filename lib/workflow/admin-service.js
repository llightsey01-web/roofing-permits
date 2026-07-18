'use strict'

/**
 * Admin-facing workflow run queries and control actions.
 */

var { createWorkflowEngine } = require('./workflow-engine.js')
var { RUN_STATUS } = require('./constants.js')

function getWorkflows() {
  return require('../../workflows/index.js')
}

function buildWorkflowForRun(run, options) {
  var o = options || {}
  var workflows = getWorkflows()
  if (run.workflow_key === 'epn') {
    return workflows.buildEpnWorkflow({ dryRun: Boolean(o.dryRun) })
  }
  if (run.workflow_key === 'permit') {
    return workflows.buildPermitWorkflow({ dryRun: Boolean(o.dryRun) })
  }
  return null
}

async function attachDispatchContext(engine, run, options) {
  var o = options || {}
  var context = Object.assign({}, o.context || {})
  if (o.dryRun || o.useLegacyBridge === false) return context

  var workflows = getWorkflows()
  if (run.workflow_key === 'epn') {
    context.dispatchActivity = await workflows.createEpnActivityDispatcher(engine)
  } else if (run.workflow_key === 'permit') {
    context.dispatchActivity = await workflows.createLegacyActivityDispatcher(engine)
  }
  return context
}

async function listWorkflowRuns(filters) {
  var f = filters || {}
  var engine = f.engine || createWorkflowEngine()
  var supabase = engine.state.supabase
  var limit = Math.min(Math.max(parseInt(f.limit, 10) || 50, 1), 200)
  var offset = Math.max(parseInt(f.offset, 10) || 0, 0)

  var query = supabase
    .from('workflow_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (f.status && f.status !== 'all') query = query.eq('status', f.status)
  if (f.workflowKey && f.workflowKey !== 'all') query = query.eq('workflow_key', f.workflowKey)
  if (f.jobId) query = query.eq('job_id', f.jobId)
  if (f.companyId) query = query.eq('company_id', f.companyId)
  if (f.q) {
    var q = String(f.q).trim().replace(/[,()]/g, '')
    if (q) {
      // Prefer exact id matches; also allow step key substring via ilike when not uuid-like
      if (/^[0-9a-f-]{8,}$/i.test(q)) {
        query = query.or('id.eq.' + q + ',job_id.eq.' + q)
      } else {
        query = query.ilike('current_step_key', '%' + q + '%')
      }
    }
  }

  var { data, error, count } = await query
  if (error) throw new Error('listWorkflowRuns: ' + error.message)

  var runs = data || []
  var jobIds = []
  var companyIds = []
  runs.forEach(function (r) {
    if (r.job_id && jobIds.indexOf(r.job_id) < 0) jobIds.push(r.job_id)
    if (r.company_id && companyIds.indexOf(r.company_id) < 0) companyIds.push(r.company_id)
  })

  var jobsById = {}
  var companiesById = {}

  if (jobIds.length) {
    var jobsRes = await supabase
      .from('jobs')
      .select('id, company_id, property_address, property_city, property_state, job_status, noc_status')
      .in('id', jobIds)
    ;(jobsRes.data || []).forEach(function (j) {
      jobsById[j.id] = j
      if (j.company_id && companyIds.indexOf(j.company_id) < 0) companyIds.push(j.company_id)
    })
  }

  if (companyIds.length) {
    var cosRes = await supabase.from('companies').select('id, name').in('id', companyIds)
    ;(cosRes.data || []).forEach(function (c) {
      companiesById[c.id] = c
    })
  }

  // Status counts (lightweight head queries)
  var statusKeys = [
    RUN_STATUS.QUEUED,
    RUN_STATUS.RUNNING,
    RUN_STATUS.WAITING,
    RUN_STATUS.PAUSED,
    RUN_STATUS.FAILED,
    RUN_STATUS.COMPLETED,
    RUN_STATUS.CANCELLED,
  ]
  var counts = {}
  await Promise.all(
    statusKeys.map(async function (status) {
      var res = await supabase
        .from('workflow_runs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      counts[status] = res.count || 0
    })
  )

  var enriched = runs.map(function (run) {
    var job = run.job_id ? jobsById[run.job_id] : null
    var companyId = run.company_id || (job && job.company_id) || null
    return Object.assign({}, run, {
      job: job || null,
      company: companyId ? companiesById[companyId] || null : null,
    })
  })

  return {
    runs: enriched,
    total: count != null ? count : enriched.length,
    limit: limit,
    offset: offset,
    counts: counts,
  }
}

async function getWorkflowRunDetail(runId, options) {
  var o = options || {}
  if (!runId) throw new Error('getWorkflowRunDetail: runId required')

  var engine = o.engine || createWorkflowEngine()
  var supabase = engine.state.supabase
  var run = await engine.state.getRun(runId)
  if (!run) {
    var err = new Error('Workflow run not found')
    err.status = 404
    throw err
  }

  var [
    steps,
    eventsRes,
    logsRes,
    artifacts,
    failuresRes,
    overridesRes,
    activitiesRes,
    historyRes,
  ] = await Promise.all([
    engine.state.listSteps(runId),
    supabase
      .from('workflow_events')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(o.eventLimit || 100),
    supabase
      .from('workflow_logs')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(o.logLimit || 200),
    engine.artifacts.listArtifacts(runId),
    supabase
      .from('workflow_failures')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('workflow_manual_overrides')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('workflow_activities')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('workflow_step_history')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  var job = null
  var company = null
  if (run.job_id) {
    var jobRes = await supabase
      .from('jobs')
      .select(
        'id, company_id, property_address, property_city, property_state, property_zip, owner_name, job_status, noc_status'
      )
      .eq('id', run.job_id)
      .maybeSingle()
    job = jobRes.data || null
  }
  var companyId = run.company_id || (job && job.company_id) || null
  if (companyId) {
    var cosRes = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', companyId)
      .maybeSingle()
    company = cosRes.data || null
  }

  // Signed URLs for screenshot-like artifacts (best-effort)
  var artifactsWithUrls = []
  for (var i = 0; i < (artifacts || []).length; i++) {
    var art = artifacts[i]
    var row = Object.assign({}, art)
    if (art.storage_bucket && art.storage_path) {
      try {
        var signed = await supabase.storage
          .from(art.storage_bucket)
          .createSignedUrl(art.storage_path, 3600)
        row.signed_url = signed.data && signed.data.signedUrl ? signed.data.signedUrl : null
      } catch (e) {
        row.signed_url = null
      }
    }
    artifactsWithUrls.push(row)
  }

  return {
    run: run,
    job: job,
    company: company,
    steps: steps || [],
    events: eventsRes.data || [],
    logs: logsRes.data || [],
    artifacts: artifactsWithUrls,
    failures: failuresRes.data || [],
    overrides: overridesRes.data || [],
    activities: activitiesRes.data || [],
    stepHistory: historyRes.data || [],
  }
}

async function resumeAdminRun(runId, options) {
  var o = options || {}
  var engine = o.engine || createWorkflowEngine()
  var run = await engine.state.getRun(runId)
  if (!run) throw Object.assign(new Error('Workflow run not found'), { status: 404 })

  var workflows = getWorkflows()
  if (run.workflow_key === 'epn') {
    return workflows.resumeEpnWorkflow(runId, {
      engine: engine,
      reason: o.reason || 'admin resume',
      actorUserId: o.actorUserId,
      source: 'admin',
      completeCurrentStep: o.completeCurrentStep !== false,
      stepOutput: o.stepOutput || {},
      startFromStep: o.startFromStep,
      useLegacyBridge: o.useLegacyBridge !== false,
      dryRun: Boolean(o.dryRun),
      fromFailed: Boolean(o.fromFailed),
    })
  }

  if (run.workflow_key === 'permit') {
    return workflows.resumePermitWorkflow(runId, {
      engine: engine,
      reason: o.reason || 'admin resume',
      actorUserId: o.actorUserId,
      source: 'admin',
      completeCurrentStep: o.completeCurrentStep !== false,
      stepOutput: o.stepOutput || {},
      startFromStep: o.startFromStep,
      useLegacyBridge: o.useLegacyBridge !== false,
      dryRun: Boolean(o.dryRun),
      fromFailed: Boolean(o.fromFailed),
    })
  }

  var workflow = buildWorkflowForRun(run, o)
  return engine.resumeWorkflow(runId, workflow, {
    reason: o.reason || 'admin resume',
    actorUserId: o.actorUserId,
    source: 'admin',
    completeCurrentStep: o.completeCurrentStep !== false,
    stepOutput: o.stepOutput || {},
    startFromStep: o.startFromStep,
    fromFailed: Boolean(o.fromFailed),
  })
}

async function cancelAdminRun(runId, options) {
  var o = options || {}
  var engine = o.engine || createWorkflowEngine()
  return engine.cancelWorkflow(runId, o.reason || 'cancelled by admin', {
    userId: o.actorUserId,
  })
}

async function retryAdminStep(runId, options) {
  var o = options || {}
  var engine = o.engine || createWorkflowEngine()
  var run = await engine.state.getRun(runId)
  if (!run) throw Object.assign(new Error('Workflow run not found'), { status: 404 })

  var stepKey = o.stepKey || run.current_step_key
  if (!stepKey) throw new Error('retry: stepKey required (or run must have current_step_key)')

  var workflow = buildWorkflowForRun(run, o)
  var context = await attachDispatchContext(engine, run, o)

  if (run.workflow_key === 'epn' || run.workflow_key === 'permit') {
    // Prefer typed resume after resetting step via engine.retryStep
  }

  return engine.retryStep(runId, stepKey, workflow, {
    reason: o.reason || 'admin retry',
    actorUserId: o.actorUserId,
    context: context,
    useLegacyBridge: o.useLegacyBridge,
    dryRun: o.dryRun,
  })
}

async function forceAdminStep(runId, options) {
  var o = options || {}
  var engine = o.engine || createWorkflowEngine()
  var run = await engine.state.getRun(runId)
  if (!run) throw Object.assign(new Error('Workflow run not found'), { status: 404 })

  var workflow = buildWorkflowForRun(run, o)
  var context = await attachDispatchContext(engine, run, o)

  return engine.forceNextStep(runId, workflow, {
    reason: o.reason || 'admin force next step',
    actorUserId: o.actorUserId,
    stepOutput: o.stepOutput || {},
    context: context,
  })
}

async function restartAdminFrom(runId, options) {
  var o = options || {}
  if (!o.stepKey) throw new Error('restart-from: stepKey required')

  var engine = o.engine || createWorkflowEngine()
  var run = await engine.state.getRun(runId)
  if (!run) throw Object.assign(new Error('Workflow run not found'), { status: 404 })

  var workflow = buildWorkflowForRun(run, o)
  if (!workflow) throw new Error('Unknown workflow_key: ' + run.workflow_key)

  var context = await attachDispatchContext(engine, run, o)
  return engine.restartFromStep(runId, o.stepKey, workflow, {
    reason: o.reason || 'admin restart from step',
    actorUserId: o.actorUserId,
    context: context,
  })
}

module.exports = {
  listWorkflowRuns: listWorkflowRuns,
  getWorkflowRunDetail: getWorkflowRunDetail,
  resumeAdminRun: resumeAdminRun,
  cancelAdminRun: cancelAdminRun,
  retryAdminStep: retryAdminStep,
  forceAdminStep: forceAdminStep,
  restartAdminFrom: restartAdminFrom,
  buildWorkflowForRun: buildWorkflowForRun,
}
