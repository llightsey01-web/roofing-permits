'use strict'

/**
 * Durable workflow observability — structured logs + screenshots/HTML in Supabase.
 *
 * Used by:
 *  - workflow step runner (timing + failure evidence)
 *  - Playwright logStep / forensics bridges (mirror legacy captures)
 */

var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')
var { createWorkflowArtifacts } = require('./workflow-artifacts.js')

var SCREENSHOTS_BUCKET = 'screenshots'
var DEFAULT_DOCS_BUCKET = 'job-documents'

function createObservability(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var logger = opts.logger || createWorkflowLogger({ state: state })
  var artifacts = opts.artifacts || createWorkflowArtifacts({ state: state, logger: logger })

  /**
   * Resolve workflow ids from a legacy automation_runs row / payload.
   */
  async function resolveFromLegacyRun(legacyRunId) {
    if (!legacyRunId) return null
    var { data, error } = await state.supabase
      .from('automation_runs')
      .select('id, job_id, payload')
      .eq('id', legacyRunId)
      .maybeSingle()
    if (error || !data) return null
    var payload = data.payload || {}
    if (!payload.workflow_run_id) return null
    return {
      legacyRunId: data.id,
      jobId: data.job_id || null,
      workflowRunId: payload.workflow_run_id,
      workflowStepId: payload.workflow_step_id || null,
      workflowActivityId: payload.workflow_activity_id || null,
      stepKey: payload.stepKey || payload.step_key || null,
    }
  }

  async function logStructured(input) {
    var i = input || {}
    if (!i.runId) return { ok: false, error: 'no_run_id' }
    var level = i.level || 'info'
    var write = logger[level] || logger.info
    return write(
      i.message || 'workflow event',
      Object.assign(
        {
          stepKey: i.stepKey || null,
          durationMs: i.durationMs != null ? i.durationMs : null,
          attempt: i.attempt != null ? i.attempt : null,
          success: i.success != null ? i.success : null,
        },
        i.context || {}
      ),
      { runId: i.runId, stepId: i.stepId || null }
    )
  }

  /**
   * Record an already-uploaded storage object as a workflow artifact.
   */
  async function recordStoredScreenshot(input) {
    var i = input || {}
    if (!i.runId || !i.storagePath) return null
    return artifacts.recordArtifact({
      runId: i.runId,
      stepId: i.stepId || null,
      artifactType: i.artifactType || 'screenshot',
      name: i.name || i.storagePath.split('/').pop() || 'screenshot.png',
      storageBucket: i.storageBucket || SCREENSHOTS_BUCKET,
      storagePath: i.storagePath,
      contentType: i.contentType || 'image/png',
      sizeBytes: i.sizeBytes != null ? i.sizeBytes : null,
      metadata: Object.assign(
        {
          stepKey: i.stepKey || null,
          label: i.label || null,
          success: i.success != null ? i.success : null,
          source: i.source || 'observability',
        },
        i.metadata || {}
      ),
    })
  }

  async function recordStoredHtml(input) {
    var i = input || {}
    if (!i.runId || !i.storagePath) return null
    return artifacts.recordArtifact({
      runId: i.runId,
      stepId: i.stepId || null,
      artifactType: 'html_snapshot',
      name: i.name || i.storagePath.split('/').pop() || 'page.html',
      storageBucket: i.storageBucket || SCREENSHOTS_BUCKET,
      storagePath: i.storagePath,
      contentType: 'text/html',
      sizeBytes: i.sizeBytes != null ? i.sizeBytes : null,
      metadata: Object.assign(
        {
          stepKey: i.stepKey || null,
          label: i.label || null,
          url: i.url || null,
          source: i.source || 'observability',
        },
        i.metadata || {}
      ),
    })
  }

  /**
   * Capture Playwright page screenshot (+ optional HTML) into Storage and workflow_artifacts.
   */
  async function capturePageEvidence(input) {
    var i = input || {}
    if (!i.runId) throw new Error('capturePageEvidence: runId required')
    if (!i.page) return { skipped: true, reason: 'no_page' }

    var page = i.page
    var stepKey = i.stepKey || 'step'
    var label = i.label || (i.success === false ? 'failure' : 'capture')
    var stamp = Date.now()
    var base =
      'workflows/' +
      i.runId +
      '/steps/' +
      String(stepKey).replace(/[^a-zA-Z0-9_-]/g, '_') +
      '/' +
      label +
      '-' +
      stamp

    var screenshotPath = null
    var htmlPath = null
    var url = null
    var title = null
    var sizeBytes = null

    try {
      if (typeof page.url === 'function') url = page.url()
    } catch (e) {}
    try {
      if (typeof page.title === 'function') title = await page.title()
    } catch (e) {}

    try {
      if (typeof page.screenshot === 'function') {
        var png = await page.screenshot({
          fullPage: i.fullPage !== false,
          type: 'png',
        })
        screenshotPath = base + '.png'
        sizeBytes = png && png.length ? png.length : null
        var { error: upErr } = await state.supabase.storage
          .from(SCREENSHOTS_BUCKET)
          .upload(screenshotPath, png, {
            contentType: 'image/png',
            upsert: true,
          })
        if (upErr) {
          // Fallback bucket used by some forensics paths
          screenshotPath = base + '.png'
          var second = await state.supabase.storage
            .from(DEFAULT_DOCS_BUCKET)
            .upload(screenshotPath, png, {
              contentType: 'image/png',
              upsert: true,
            })
          if (second.error) throw second.error
          await recordStoredScreenshot({
            runId: i.runId,
            stepId: i.stepId,
            stepKey: stepKey,
            label: label,
            success: i.success,
            storageBucket: DEFAULT_DOCS_BUCKET,
            storagePath: screenshotPath,
            sizeBytes: sizeBytes,
            metadata: { url: url, title: title },
            source: i.source || 'playwright',
          })
        } else {
          await recordStoredScreenshot({
            runId: i.runId,
            stepId: i.stepId,
            stepKey: stepKey,
            label: label,
            success: i.success,
            storageBucket: SCREENSHOTS_BUCKET,
            storagePath: screenshotPath,
            sizeBytes: sizeBytes,
            metadata: { url: url, title: title },
            source: i.source || 'playwright',
          })
        }
      }
    } catch (shotErr) {
      await logStructured({
        runId: i.runId,
        stepId: i.stepId,
        stepKey: stepKey,
        level: 'warn',
        message: 'screenshot capture failed: ' + stepKey,
        context: { error: shotErr.message, label: label },
      })
    }

    if (i.includeHtml !== false) {
      try {
        if (typeof page.content === 'function') {
          var html = await page.content()
          htmlPath = base + '.html'
          var htmlBuf = Buffer.from(html, 'utf8')
          var bucket = SCREENSHOTS_BUCKET
          var htmlUp = await state.supabase.storage.from(bucket).upload(htmlPath, htmlBuf, {
            contentType: 'text/html',
            upsert: true,
          })
          if (htmlUp.error) {
            bucket = DEFAULT_DOCS_BUCKET
            htmlUp = await state.supabase.storage.from(bucket).upload(htmlPath, htmlBuf, {
              contentType: 'text/html',
              upsert: true,
            })
          }
          if (!htmlUp.error) {
            await recordStoredHtml({
              runId: i.runId,
              stepId: i.stepId,
              stepKey: stepKey,
              label: label,
              storageBucket: bucket,
              storagePath: htmlPath,
              sizeBytes: htmlBuf.length,
              url: url,
              metadata: { title: title },
              source: i.source || 'playwright',
            })
          }
        }
      } catch (htmlErr) {
        await logStructured({
          runId: i.runId,
          stepId: i.stepId,
          stepKey: stepKey,
          level: 'warn',
          message: 'html snapshot failed: ' + stepKey,
          context: { error: htmlErr.message, label: label },
        })
      }
    }

    await logStructured({
      runId: i.runId,
      stepId: i.stepId,
      stepKey: stepKey,
      level: i.success === false ? 'error' : 'info',
      message: 'evidence captured: ' + stepKey + '/' + label,
      success: i.success !== false,
      context: {
        screenshotPath: screenshotPath,
        htmlPath: htmlPath,
        url: url,
        title: title,
        label: label,
      },
    })

    return {
      screenshotPath: screenshotPath,
      htmlPath: htmlPath,
      url: url,
      title: title,
    }
  }

  /**
   * Mirror a legacy automation screenshot path into workflow_artifacts + log.
   */
  async function mirrorLegacyCapture(input) {
    var i = input || {}
    var ids = i.workflowRunId
      ? {
          workflowRunId: i.workflowRunId,
          workflowStepId: i.workflowStepId || null,
          stepKey: i.stepKey || null,
        }
      : await resolveFromLegacyRun(i.legacyRunId)

    if (!ids || !ids.workflowRunId) {
      return { skipped: true, reason: 'no_workflow_link' }
    }

    var recorded = []
    if (i.screenshotPath) {
      var shot = await recordStoredScreenshot({
        runId: ids.workflowRunId,
        stepId: ids.workflowStepId || i.workflowStepId || null,
        stepKey: ids.stepKey || i.stepKey || i.stepName || null,
        label: i.label || i.stepName || 'legacy_step',
        success: i.success,
        storageBucket: i.storageBucket || SCREENSHOTS_BUCKET,
        storagePath: i.screenshotPath,
        source: i.source || 'legacy_automation',
        metadata: {
          legacyRunId: i.legacyRunId || ids.legacyRunId || null,
          stepNumber: i.stepNumber != null ? i.stepNumber : null,
          stepName: i.stepName || null,
        },
      })
      recorded.push(shot)
    }

    if (i.htmlPath) {
      var html = await recordStoredHtml({
        runId: ids.workflowRunId,
        stepId: ids.workflowStepId || i.workflowStepId || null,
        stepKey: ids.stepKey || i.stepKey || i.stepName || null,
        label: i.label || i.stepName || 'legacy_html',
        storageBucket: i.storageBucket || i.htmlBucket || SCREENSHOTS_BUCKET,
        storagePath: i.htmlPath,
        url: i.url || null,
        source: i.source || 'legacy_automation',
        metadata: {
          legacyRunId: i.legacyRunId || ids.legacyRunId || null,
        },
      })
      recorded.push(html)
    }

    await logStructured({
      runId: ids.workflowRunId,
      stepId: ids.workflowStepId || i.workflowStepId || null,
      stepKey: ids.stepKey || i.stepKey || i.stepName || null,
      level: i.success === false ? 'warn' : 'info',
      message:
        'mirrored legacy capture: ' +
        (i.stepName || i.label || 'step') +
        (i.success === false ? ' (failure)' : ''),
      success: i.success !== false,
      context: {
        screenshotPath: i.screenshotPath || null,
        htmlPath: i.htmlPath || null,
        legacyRunId: i.legacyRunId || ids.legacyRunId || null,
        stepNumber: i.stepNumber != null ? i.stepNumber : null,
      },
    })

    return { skipped: false, workflowRunId: ids.workflowRunId, artifacts: recorded }
  }

  /**
   * Wrap an async step body with structured timing logs.
   */
  async function withStepTiming(input, fn) {
    var i = input || {}
    var started = Date.now()
    await logStructured({
      runId: i.runId,
      stepId: i.stepId,
      stepKey: i.stepKey,
      level: 'info',
      message: 'step timing start: ' + (i.stepKey || 'unknown'),
      attempt: i.attempt,
      context: {
        stepType: i.stepType || null,
        phase: 'start',
      },
    })

    try {
      var result = await fn()
      var durationMs = Date.now() - started
      await logStructured({
        runId: i.runId,
        stepId: i.stepId,
        stepKey: i.stepKey,
        level: 'info',
        message: 'step timing end: ' + (i.stepKey || 'unknown'),
        attempt: i.attempt,
        durationMs: durationMs,
        success: true,
        context: {
          stepType: i.stepType || null,
          phase: 'end',
          waiting: !!(result && result.waiting),
        },
      })
      return result
    } catch (err) {
      var failMs = Date.now() - started
      await logStructured({
        runId: i.runId,
        stepId: i.stepId,
        stepKey: i.stepKey,
        level: 'error',
        message: 'step timing failed: ' + (i.stepKey || 'unknown'),
        attempt: i.attempt,
        durationMs: failMs,
        success: false,
        context: {
          stepType: i.stepType || null,
          phase: 'error',
          error: err.message,
          code: err.code || null,
        },
      })
      throw err
    }
  }

  return {
    state: state,
    logger: logger,
    artifacts: artifacts,
    resolveFromLegacyRun: resolveFromLegacyRun,
    logStructured: logStructured,
    recordStoredScreenshot: recordStoredScreenshot,
    recordStoredHtml: recordStoredHtml,
    capturePageEvidence: capturePageEvidence,
    mirrorLegacyCapture: mirrorLegacyCapture,
    withStepTiming: withStepTiming,
    SCREENSHOTS_BUCKET: SCREENSHOTS_BUCKET,
    DEFAULT_DOCS_BUCKET: DEFAULT_DOCS_BUCKET,
  }
}

/** Singleton-friendly factory for worker bridges (lazy). */
var _defaultObs = null
function getObservability(options) {
  if (options && (options.state || options.supabase || options.logger || options.artifacts)) {
    return createObservability(options)
  }
  if (!_defaultObs) _defaultObs = createObservability()
  return _defaultObs
}

module.exports = {
  createObservability: createObservability,
  getObservability: getObservability,
  SCREENSHOTS_BUCKET: SCREENSHOTS_BUCKET,
  DEFAULT_DOCS_BUCKET: DEFAULT_DOCS_BUCKET,
}
