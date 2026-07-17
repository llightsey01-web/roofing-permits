'use strict'

const { createClient } = require('@supabase/supabase-js')

var SERVICES = ['proof', 'epn', 'polk', 'lee', 'twocaptcha']
var FAILURE_THRESHOLD = 3
var COOLDOWN_MS = 30 * 60 * 1000

var memoryState = {}

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

function defaultState(service) {
  return {
    service: service,
    status: 'closed', // closed | open | half_open
    consecutiveFailures: 0,
    openedAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
  }
}

function getMemory(service) {
  if (!memoryState[service]) memoryState[service] = defaultState(service)
  return memoryState[service]
}

async function persistCircuitEvent(service, status, details) {
  var supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase.from('system_alerts').insert({
      type: status === 'open' ? 'circuit_open' : (status === 'half_open' ? 'circuit_half_open' : 'circuit_closed'),
      severity: status === 'open' ? 'critical' : 'info',
      message: 'Circuit breaker ' + status + ' for service: ' + service,
      details: Object.assign({ service: service, status: status }, details || {}),
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[circuit] persist failed:', err.message)
  }
}

async function notifyCircuitOpen(service, err) {
  try {
    var { sendAlert } = require('../monitoring/alert-service')
    await sendAlert({
      type: 'integration_failed',
      severity: 'critical',
      message: 'Circuit OPEN for ' + service + ' — pausing requests for 30 minutes',
      details: {
        service: service,
        errorMessage: err && err.message ? err.message : null,
      },
    })
  } catch (alertErr) {
    console.warn('[circuit] alert failed:', alertErr.message)
  }
}

function maybeHalfOpen(state) {
  if (state.status !== 'open' || !state.openedAt) return state
  var openedMs = new Date(state.openedAt).getTime()
  if (Date.now() - openedMs >= COOLDOWN_MS) {
    state.status = 'half_open'
    state.consecutiveFailures = 0
  }
  return state
}

async function getCircuitState(service) {
  var key = String(service || '').toLowerCase()
  if (SERVICES.indexOf(key) < 0) key = service
  var state = maybeHalfOpen(getMemory(key))
  return Object.assign({}, state)
}

async function assertCircuitClosed(service) {
  var state = await getCircuitState(service)
  if (state.status === 'open') {
    var err = new Error('Circuit open for ' + service + ' — requests paused until cooldown expires')
    err.code = 'CIRCUIT_OPEN'
    err.service = service
    throw err
  }
  return state
}

async function recordSuccess(service) {
  var state = getMemory(service)
  var wasOpen = state.status !== 'closed'
  state.status = 'closed'
  state.consecutiveFailures = 0
  state.openedAt = null
  state.lastSuccessAt = new Date().toISOString()
  state.lastError = null
  if (wasOpen) {
    await persistCircuitEvent(service, 'closed', { reason: 'success' })
  }
  return getCircuitState(service)
}

async function recordFailure(service, err) {
  var state = getMemory(service)
  state.consecutiveFailures += 1
  state.lastFailureAt = new Date().toISOString()
  state.lastError = err && err.message ? err.message : String(err || 'unknown')

  if (state.status === 'half_open' || state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.status = 'open'
    state.openedAt = new Date().toISOString()
    await persistCircuitEvent(service, 'open', {
      consecutiveFailures: state.consecutiveFailures,
      error: state.lastError,
    })
    await notifyCircuitOpen(service, err)
  }

  return getCircuitState(service)
}

async function getAllCircuitStates() {
  var out = {}
  for (var i = 0; i < SERVICES.length; i++) {
    out[SERVICES[i]] = await getCircuitState(SERVICES[i])
  }
  return out
}

module.exports = {
  SERVICES,
  FAILURE_THRESHOLD,
  COOLDOWN_MS,
  getCircuitState,
  getAllCircuitStates,
  assertCircuitClosed,
  recordSuccess,
  recordFailure,
}
