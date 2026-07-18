'use strict'

var constants = require('./constants.js')

/**
 * Exponential backoff delay for attempt N (1-based).
 * delay = min(maxDelay, baseDelay * 2^(attempt-1)) + optional jitter
 */
function computeBackoffMs(attempt, opts) {
  var options = opts || {}
  var base = options.baseDelayMs != null ? options.baseDelayMs : constants.DEFAULT_BASE_DELAY_MS
  var max = options.maxDelayMs != null ? options.maxDelayMs : constants.DEFAULT_MAX_DELAY_MS
  var jitter = options.jitter !== false
  var n = Math.max(1, Number(attempt) || 1)
  var delay = Math.min(max, base * Math.pow(2, n - 1))
  if (jitter) {
    delay = Math.floor(delay * (0.75 + Math.random() * 0.5))
  }
  return delay
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/**
 * Retry wrapper with exponential backoff.
 * Compatible with lib/automation/retry.js patterns but workflow-aware.
 */
async function withStepRetry(fn, opts) {
  var options = opts || {}
  var maxAttempts = options.maxAttempts || constants.DEFAULT_MAX_ATTEMPTS
  var label = options.label || 'workflow_step'
  var onError = options.onError
  var shouldRetry = options.shouldRetry
  var lastError = null

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      var retryable = true
      if (typeof shouldRetry === 'function') {
        retryable = Boolean(shouldRetry(err, attempt))
      } else if (err && err.retryable === false) {
        retryable = false
      }

      if (typeof onError === 'function') {
        try {
          await onError(err, attempt, retryable)
        } catch (hookErr) {
          console.warn('[workflow-retry] onError failed:', hookErr.message)
        }
      }

      if (!retryable || attempt >= maxAttempts) break

      var wait = computeBackoffMs(attempt, options)
      console.warn(
        '[workflow-retry] ' +
          label +
          ' attempt ' +
          attempt +
          '/' +
          maxAttempts +
          ' failed; waiting ' +
          wait +
          'ms:',
        err.message
      )
      await sleep(wait)
    }
  }

  var finalError = lastError || new Error(label + ' failed after ' + maxAttempts + ' attempts')
  finalError.attempts = maxAttempts
  throw finalError
}

module.exports = {
  computeBackoffMs: computeBackoffMs,
  sleep: sleep,
  withStepRetry: withStepRetry,
  retryStep: withStepRetry,
}
