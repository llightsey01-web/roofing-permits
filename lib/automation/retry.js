'use strict'

/**
 * Universal retry wrapper for automation steps.
 * @param {Function} fn — async function to execute
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.delayMs=1000] — base delay; doubles each attempt
 * @param {Function} [opts.onError] — async (err, attempt) => void
 * @param {string} [opts.label]
 */
async function withRetry(fn, opts) {
  var options = opts || {}
  var maxAttempts = options.maxAttempts || 3
  var delayMs = options.delayMs || 1000
  var onError = options.onError
  var label = options.label || 'operation'
  var lastError = null

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var result = await fn(attempt)
      return result
    } catch (err) {
      lastError = err
      console.error('[retry] ' + label + ' failed attempt ' + attempt + '/' + maxAttempts + ':', err.message)
      if (typeof onError === 'function') {
        try {
          await onError(err, attempt)
        } catch (hookErr) {
          console.warn('[retry] onError hook failed:', hookErr.message)
        }
      }
      if (attempt >= maxAttempts) break
      var wait = delayMs * Math.pow(2, attempt - 1)
      await new Promise(function (resolve) { setTimeout(resolve, wait) })
    }
  }

  var finalError = lastError || new Error(label + ' failed after ' + maxAttempts + ' attempts')
  finalError.attempts = maxAttempts
  throw finalError
}

module.exports = { withRetry }
