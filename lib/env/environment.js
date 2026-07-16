// lib/env/environment.js
// Environment detection and validation

const ENVIRONMENTS = ['development', 'staging', 'production']

function getEnvironment() {
  // Prefer explicit ENVIRONMENT; Railway often sets RAILWAY_ENVIRONMENT / NODE_ENV.
  const raw = process.env.ENVIRONMENT
    || process.env.RAILWAY_ENVIRONMENT
    || process.env.NODE_ENV
    || 'development'
  const env = String(raw).toLowerCase()
  console.log(
    '[env] ENVIRONMENT var:', process.env.ENVIRONMENT,
    'RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT,
    'NODE_ENV:', process.env.NODE_ENV
  )
  if (env === 'prod') return 'production'
  return env
}

function isProduction() {
  return getEnvironment() === 'production'
}

function isStaging() {
  return getEnvironment() === 'staging'
}

function isDevelopment() {
  return getEnvironment() === 'development'
}

function requireProductionGuard(actionName) {
  if (isProduction()) {
    throw new Error(
      'SAFETY: ' + actionName + ' is not allowed in production. ' +
      'Use staging environment for testing.'
    )
  }
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function validateEnvironment() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CREDENTIAL_ENCRYPTION_KEY',
    'INTERNAL_API_KEY',
  ]
  const missing = required.filter(function (k) { return !process.env[k] })
  if (missing.length > 0) {
    throw new Error('Missing required environment variables: ' + missing.join(', '))
  }
  console.log('[env] Environment:', getEnvironment())
  console.log('[env] App URL:', getAppUrl())
  return true
}

module.exports = {
  ENVIRONMENTS,
  getEnvironment,
  isProduction,
  isStaging,
  isDevelopment,
  requireProductionGuard,
  getAppUrl,
  validateEnvironment,
}
