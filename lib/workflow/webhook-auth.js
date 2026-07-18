'use strict'

/**
 * Authorize durable webhook deliveries.
 * Accepts INTERNAL_API_KEY, WORKFLOW_WEBHOOK_SECRET, or provider-specific secrets.
 */

function normalizeHeaders(headers) {
  var out = {}
  if (!headers) return out

  if (typeof headers.forEach === 'function') {
    headers.forEach(function (value, key) {
      out[String(key).toLowerCase()] = String(value)
    })
    return out
  }

  if (typeof headers.entries === 'function') {
    var it = headers.entries()
    var next = it.next()
    while (!next.done) {
      out[String(next.value[0]).toLowerCase()] = String(next.value[1])
      next = it.next()
    }
    return out
  }

  Object.keys(headers).forEach(function (key) {
    out[String(key).toLowerCase()] = String(headers[key])
  })
  return out
}

function bearerToken(headers) {
  var auth = headers.authorization || headers.Authorization || ''
  var match = String(auth).match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function secretsConfigured(providerSecretEnv) {
  return Boolean(
    (process.env.INTERNAL_API_KEY || '').trim() ||
      (process.env.WORKFLOW_WEBHOOK_SECRET || '').trim() ||
      (providerSecretEnv && (process.env[providerSecretEnv] || '').trim())
  )
}

/**
 * @param {Headers|object} headers
 * @param {{ providerSecretEnv?: string }} [options]
 */
function authorizeWebhook(headers, options) {
  var opts = options || {}
  var h = normalizeHeaders(headers)
  var bearer = bearerToken(h)

  var internal = (process.env.INTERNAL_API_KEY || '').trim()
  if (internal) {
    var providedInternal = (h['x-internal-api-key'] || '').trim()
    if (providedInternal && providedInternal === internal) {
      return { ok: true, via: 'internal_api_key' }
    }
  }

  var workflowSecret = (process.env.WORKFLOW_WEBHOOK_SECRET || '').trim()
  if (workflowSecret) {
    var providedWorkflow = (h['x-workflow-webhook-secret'] || '').trim()
    if (
      (providedWorkflow && providedWorkflow === workflowSecret) ||
      (bearer && bearer === workflowSecret)
    ) {
      return { ok: true, via: 'workflow_webhook_secret' }
    }
  }

  if (opts.providerSecretEnv) {
    var providerSecret = (process.env[opts.providerSecretEnv] || '').trim()
    if (providerSecret) {
      var providedProvider = (h['x-webhook-secret'] || h['x-provider-webhook-secret'] || '').trim()
      if (
        (providedProvider && providedProvider === providerSecret) ||
        (bearer && bearer === providerSecret)
      ) {
        return { ok: true, via: 'provider_webhook_secret' }
      }
    }
  }

  if (!secretsConfigured(opts.providerSecretEnv)) {
    return {
      ok: true,
      via: 'open_dev',
      warning: 'No webhook secrets configured; accepting request in open-dev mode',
    }
  }

  return { ok: false, status: 401, error: 'Unauthorized webhook' }
}

module.exports = {
  normalizeHeaders: normalizeHeaders,
  authorizeWebhook: authorizeWebhook,
  secretsConfigured: secretsConfigured,
}
