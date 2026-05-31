// lib/automation/noc-trigger.js
// NOC trigger after Polk Phase 1 — prefers direct server calls over HTTP fetch

const { getAppBaseUrl } = require('../app-base-url')
const { runPostPhase1Chain } = require('./noc-proof-erecord-chain')

async function triggerNocAfterPhase1Direct(jobId, options) {
  console.log('Starting NOC pipeline for job ' + jobId + ' (direct server call)...')
  var result = await runPostPhase1Chain(jobId, options || {})
  console.log('NOC phase started for job ' + jobId + ' — stopping point: ' + (result.stoppingPoint || 'unknown'))
  return result
}

async function callNocStartApi(jobId, options) {
  var opts = options || {}
  var baseUrl = opts.baseUrl || getAppBaseUrl()
  var url = baseUrl + '/api/noc/start'

  console.log('NOC API call URL: ' + url)

  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ jobId: jobId }),
    redirect: 'manual',
  })

  var status = res.status
  var contentType = res.headers.get('content-type') || ''
  var bodyText = await res.text()

  console.log('NOC API response status: ' + status)
  console.log('NOC API response content-type: ' + contentType)

  var trimmed = bodyText.trim()
  var looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  var isJsonContentType = contentType.includes('application/json')

  if (!isJsonContentType && !looksLikeJson) {
    console.error('NOC API returned non-JSON body (first 300 chars):')
    console.error(bodyText.substring(0, 300))
    var err = new Error(
      'NOC API returned non-JSON response (status ' + status + ', content-type: ' + contentType + ')'
    )
    err.status = status
    err.contentType = contentType
    err.bodyPreview = bodyText.substring(0, 300)
    throw err
  }

  try {
    return JSON.parse(bodyText)
  } catch (parseErr) {
    console.error('NOC API JSON parse failed (first 300 chars):')
    console.error(bodyText.substring(0, 300))
    throw parseErr
  }
}

/**
 * Trigger NOC after Phase 1. Node automation should use direct call (default).
 * Pass useHttpApi: true only for explicit API testing.
 */
async function triggerNocAfterPhase1(jobId, options) {
  var opts = options || {}
  if (opts.useHttpApi) {
    return callNocStartApi(jobId, opts)
  }
  return triggerNocAfterPhase1Direct(jobId, opts)
}

module.exports = {
  triggerNocAfterPhase1,
  triggerNocAfterPhase1Direct,
  callNocStartApi,
}
