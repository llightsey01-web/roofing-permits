// lib/credentials/credential-loader.js
// Unified credential loader for all workers and automation modules
'use strict'

const { createClient } = require('@supabase/supabase-js')
const {
  decryptCredential,
} = require('../crypto/credential-encryption.js')

const PROVIDER_ALIASES = {
  polk_county: 'polk_accela',
  lee_county: 'lee_accela',
}

const ENV_KEYS = {
  epn: { email: 'EPN_EMAIL', password: 'EPN_PASSWORD' },
  proof: { email: 'PROOF_EMAIL', password: 'PROOF_PASSWORD' },
  twocaptcha: { apiKey: 'TWOCAPTCHA_API_KEY' },
  polk_county: { username: 'POLK_COUNTY_USERNAME', password: 'POLK_COUNTY_PASSWORD' },
  lee_county: { username: 'LEE_COUNTY_USERNAME', password: 'LEE_COUNTY_PASSWORD' },
  polk_accela: { username: 'POLK_COUNTY_USERNAME', password: 'POLK_COUNTY_PASSWORD' },
  lee_accela: { username: 'LEE_COUNTY_USERNAME', password: 'LEE_COUNTY_PASSWORD' },
}

function isVaultEnabled() {
  return process.env.CREDENTIAL_VAULT_ENABLED === 'true'
}

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

function allowEnvFallback() {
  return !isVaultEnabled() || !isProduction()
}

function normalizeProvider(provider) {
  return PROVIDER_ALIASES[provider] || provider
}

function getSupabaseClient() {
  var ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function decryptField(value) {
  if (!value) return null
  return decryptCredential(value)
}

function decryptExtra(extra) {
  if (!extra || typeof extra !== 'object') return null
  var out = {}
  for (var key of Object.keys(extra)) {
    if (extra[key]) out[key] = decryptCredential(String(extra[key]))
  }
  return out
}

async function fetchCompanyCredentialRow(companyId, provider, ahjId) {
  if (!companyId) return null
  var supabase = getSupabaseClient()
  var query = supabase
    .from('company_credentials')
    .select('id, encrypted_username, encrypted_password, encrypted_extra, provider, credential_type')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .eq('is_active', true)

  if (ahjId) {
    query = query.eq('ahj_id', ahjId)
  } else {
    query = query.is('ahj_id', null)
  }

  var { data, error } = await query.maybeSingle()
  if (error || !data) return null

  await supabase
    .from('company_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)

  return data
}

async function fetchLegacyAhjCredential(companyId, ahjId) {
  if (!companyId || !ahjId) return null
  var supabase = getSupabaseClient()
  var { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, password_encrypted, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return null

  var password = data.portal_password || null
  if (!password && data.password_encrypted) {
    password = decryptField(data.password_encrypted)
  }
  if (!password) return null

  return { username: data.username, password: password }
}

async function mapVaultRowToCredentials(provider, row) {
  if (!row) return null

  var username = row.encrypted_username ? decryptField(row.encrypted_username) : null
  var password = row.encrypted_password ? decryptField(row.encrypted_password) : null
  var extra = row.encrypted_extra ? decryptExtra(row.encrypted_extra) : null

  if (provider === 'epn') {
    return { email: username, password: password }
  }
  if (provider === 'proof') {
    return { email: username, password: password }
  }
  if (provider === 'twocaptcha') {
    return { apiKey: (extra && extra.apiKey) || password || username }
  }
  return { username: username, password: password }
}

function loadEnvCredentials(provider) {
  if (provider === 'supabase') {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
  }

  var keys = ENV_KEYS[provider]
  if (!keys) return null

  if (keys.apiKey) {
    return { apiKey: process.env[keys.apiKey] }
  }

  var emailOrUser = keys.email ? process.env[keys.email] : process.env[keys.username]
  var password = process.env[keys.password]
  if (keys.email) {
    return { email: emailOrUser, password: password }
  }
  return { username: emailOrUser, password: password }
}

function isCredentialComplete(provider, creds) {
  if (!creds) return false
  if (provider === 'supabase') {
    return !!(creds.url && creds.serviceRoleKey)
  }
  if (provider === 'twocaptcha') {
    return !!(creds.apiKey && String(creds.apiKey).trim())
  }
  if (provider === 'epn' || provider === 'proof') {
    return !!(creds.email && String(creds.email).trim() && creds.password && String(creds.password).trim())
  }
  return !!(creds.username && String(creds.username).trim() && creds.password && String(creds.password).trim())
}

/**
 * Load credentials for a given provider/company/AHJ combination.
 *
 * @param {object} opts
 * @param {string} opts.provider
 * @param {string} [opts.companyId]
 * @param {string} [opts.ahjId]
 * @returns {Promise<object>}
 */
async function getCredential({ provider, companyId, ahjId }) {
  if (!provider) throw new Error('provider is required')

  if (provider === 'supabase') {
    return loadEnvCredentials('supabase')
  }

  var normalized = normalizeProvider(provider)
  var vaultRow = await fetchCompanyCredentialRow(companyId, normalized, ahjId || null)
  var vaultCreds = await mapVaultRowToCredentials(normalized, vaultRow)
  if (isCredentialComplete(normalized, vaultCreds)) {
    return vaultCreds
  }

  if (ahjId || normalized === 'polk_accela' || normalized === 'lee_accela') {
    var legacy = await fetchLegacyAhjCredential(companyId, ahjId)
    if (legacy && legacy.username && legacy.password) {
      return { username: legacy.username, password: legacy.password }
    }
  }

  if (allowEnvFallback()) {
    var envCreds = loadEnvCredentials(provider) || loadEnvCredentials(normalized)
    if (isCredentialComplete(normalized, envCreds) || isCredentialComplete(provider, envCreds)) {
      return envCreds
    }
  }

  throw new Error('Missing company credential for provider ' + provider)
}

module.exports = {
  getCredential,
  isVaultEnabled,
  allowEnvFallback,
  normalizeProvider,
}
