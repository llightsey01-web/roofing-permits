'use strict'

var { createWorkflowState } = require('./workflow-state.js')

/**
 * Structured workflow logger → workflow_logs (+ console).
 */
function createWorkflowLogger(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var defaultRunId = opts.runId || null
  var defaultStepId = opts.stepId || null

  async function write(level, message, context, ids) {
    var id = ids || {}
    var runId = id.runId || defaultRunId
    var stepId = id.stepId || defaultStepId
    var ctx = context || {}

    var line =
      '[workflow:' +
      level +
      ']' +
      (runId ? ' run=' + String(runId).slice(0, 8) : '') +
      (stepId ? ' step=' + String(stepId).slice(0, 8) : '') +
      ' ' +
      message

    if (level === 'error') console.error(line, ctx)
    else if (level === 'warn') console.warn(line, ctx)
    else console.log(line)

    if (!runId) return { ok: false, error: 'no_run_id' }

    try {
      var { error } = await state.supabase.from('workflow_logs').insert({
        run_id: runId,
        step_id: stepId || null,
        level: level,
        message: String(message),
        context: ctx,
      })
      if (error) {
        console.warn('[workflow-logger] insert failed:', error.message)
        return { ok: false, error: error.message }
      }
      return { ok: true }
    } catch (err) {
      console.warn('[workflow-logger] error:', err.message)
      return { ok: false, error: err.message }
    }
  }

  return {
    debug: function (message, context, ids) {
      return write('debug', message, context, ids)
    },
    info: function (message, context, ids) {
      return write('info', message, context, ids)
    },
    warn: function (message, context, ids) {
      return write('warn', message, context, ids)
    },
    error: function (message, context, ids) {
      return write('error', message, context, ids)
    },
    child: function (ids) {
      return createWorkflowLogger({
        state: state,
        supabase: opts.supabase,
        runId: (ids && ids.runId) || defaultRunId,
        stepId: (ids && ids.stepId) || defaultStepId,
      })
    },
  }
}

module.exports = {
  createWorkflowLogger: createWorkflowLogger,
}
