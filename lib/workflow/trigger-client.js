'use strict'

/**
 * Optional Trigger.dev client helpers for Next.js / workers.
 * Falls back to in-process workflow engine when TRIGGER_SECRET_KEY is unset.
 */

function isTriggerConfigured() {
  return Boolean((process.env.TRIGGER_SECRET_KEY || '').trim())
}

async function getTasksApi() {
  if (!isTriggerConfigured()) return null
  var sdk = await import('@trigger.dev/sdk')
  return sdk.tasks || null
}

/**
 * Start ePN workflow via Trigger when configured; otherwise local engine.
 */
async function dispatchEpnWorkflow(payload) {
  var tasks = await getTasksApi()
  if (tasks) {
    var handle = await tasks.trigger('epn-workflow', payload || {})
    return { mode: 'trigger', handle: handle }
  }
  var { startEpnWorkflow } = require('../../workflows/epn-workflow.js')
  var result = await startEpnWorkflow(payload || {})
  return { mode: 'local', run: result.run }
}

async function dispatchPermitWorkflow(payload) {
  var tasks = await getTasksApi()
  if (tasks) {
    var handle = await tasks.trigger('permit-workflow', payload || {})
    return { mode: 'trigger', handle: handle }
  }
  var { startPermitWorkflow } = require('../../workflows/permit-workflow.js')
  var result = await startPermitWorkflow(payload || {})
  return { mode: 'local', run: result.run }
}

async function dispatchResumeWorkflow(payload) {
  var p = payload || {}
  var tasks = await getTasksApi()
  if (tasks) {
    var taskId =
      p.workflowKey === 'epn' ? 'epn-workflow-resume' : 'permit-workflow-resume'
    var handle = await tasks.trigger(taskId, p)
    return { mode: 'trigger', handle: handle }
  }

  if (p.workflowKey === 'epn') {
    var epn = require('../../workflows/epn-workflow.js')
    var run = await epn.resumeEpnWorkflow(p.runId, p)
    return { mode: 'local', run: run }
  }

  var permit = require('../../workflows/permit-workflow.js')
  var permitRun = await permit.resumePermitWorkflow(p.runId, p)
  return { mode: 'local', run: permitRun }
}

module.exports = {
  isTriggerConfigured: isTriggerConfigured,
  getTasksApi: getTasksApi,
  dispatchEpnWorkflow: dispatchEpnWorkflow,
  dispatchPermitWorkflow: dispatchPermitWorkflow,
  dispatchResumeWorkflow: dispatchResumeWorkflow,
}
