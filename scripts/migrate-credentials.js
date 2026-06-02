#!/usr/bin/env node
// One-time migration: seed company_credentials from company_ahj_credentials + env vars
// Does NOT delete legacy data. Dry-run by default — pass --execute to write rows.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })

const GAETANO_COMPANY_ID = '384062a1-38eb-4612-a01c-6ae467d5d22f'
const POLK_AHJ_ID = '6d54bac8-9306-4fb4-b042-fbe086c007f2'
const LEE_AHJ_ID = '1752d716-71de-41f9-ae58-4f9ae37cc349'

async function loadServices() {
  var mod = await import('../lib/credentials/secure-credential-service.js')
  return mod.default || mod
}

async function loadSupabase() {
  var ws = require('ws')
  var { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function mask(value) {
  if (!value) return '(missing)'
  return String(value).slice(0, 2) + '••••'
}

async function buildPlan() {
  var supabase = await loadSupabase()
  var plan = []

  var { data: ahjRows, error } = await supabase
    .from('company_ahj_credentials')
    .select('id, company_id, ahj_id, credential_key_ref, username, portal_password, password_encrypted, is_active')
    .eq('is_active', true)

  if (error) throw new Error('Failed to load company_ahj_credentials: ' + error.message)

  for (var row of ahjRows || []) {
    var provider = row.credential_key_ref === 'LEE_COUNTY'
      ? 'lee_accela'
      : row.credential_key_ref === 'POLK_COUNTY'
        ? 'polk_accela'
        : null
    if (!provider) continue

    plan.push({
      source: 'company_ahj_credentials:' + row.id,
      companyId: row.company_id,
      provider: provider,
      ahjId: row.ahj_id,
      username: row.username,
      password: row.portal_password || '(encrypted column — decrypt at runtime)',
      credentialType: 'ahj_portal',
    })
  }

  if (process.env.EPN_EMAIL && process.env.EPN_PASSWORD) {
    plan.push({
      source: 'env:EPN',
      companyId: GAETANO_COMPANY_ID,
      provider: 'epn',
      ahjId: null,
      username: process.env.EPN_EMAIL,
      password: process.env.EPN_PASSWORD,
      credentialType: 'erecord',
    })
  }

  if (process.env.PROOF_EMAIL && process.env.PROOF_PASSWORD) {
    plan.push({
      source: 'env:PROOF',
      companyId: GAETANO_COMPANY_ID,
      provider: 'proof',
      ahjId: null,
      username: process.env.PROOF_EMAIL,
      password: process.env.PROOF_PASSWORD,
      credentialType: 'proof',
    })
  }

  if (process.env.TWOCAPTCHA_API_KEY) {
    plan.push({
      source: 'env:TWOCAPTCHA',
      companyId: GAETANO_COMPANY_ID,
      provider: 'twocaptcha',
      ahjId: null,
      username: null,
      password: null,
      extra: { apiKey: process.env.TWOCAPTCHA_API_KEY },
      credentialType: 'api_key',
    })
  }

  return plan
}

async function executePlan(plan) {
  var service = await loadServices()
  var supabase = await loadSupabase()
  var results = []

  for (var item of plan) {
    if (String(item.password).indexOf('encrypted column') >= 0) {
      var { data: legacy } = await supabase
        .from('company_ahj_credentials')
        .select('username, portal_password, password_encrypted')
        .eq('company_id', item.companyId)
        .eq('ahj_id', item.ahjId)
        .single()

      var password = legacy?.portal_password || null
      if (!password && legacy?.password_encrypted) {
        var crypto = await import('../lib/crypto/credential-encryption.js')
        password = crypto.decryptCredential(legacy.password_encrypted)
      }
      item.username = legacy?.username || item.username
      item.password = password
    }

    if (!item.password && !item.extra) {
      results.push({ source: item.source, skipped: true, reason: 'missing secret value' })
      continue
    }

    var saved = await service.saveCredential({
      companyId: item.companyId,
      provider: item.provider,
      ahjId: item.ahjId,
      username: item.username,
      password: item.password,
      extra: item.extra || null,
      credentialType: item.credentialType,
    })

    results.push({ source: item.source, saved: true, id: saved.id, provider: saved.provider })
  }

  return results
}

async function main() {
  var execute = process.argv.includes('--execute')
  var plan = await buildPlan()

  console.log('Credential migration plan (' + plan.length + ' rows):')
  plan.forEach(function(item) {
    console.log('  - ' + item.source + ' → provider=' + item.provider +
      ' company=' + item.companyId +
      ' ahj=' + (item.ahjId || 'null') +
      ' user=' + mask(item.username) +
      ' pass=' + mask(item.password))
  })

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to write to company_credentials.')
    return
  }

  console.log('\nExecuting migration...')
  var results = await executePlan(plan)
  console.log(JSON.stringify(results, null, 2))
  console.log('Migration complete — legacy tables untouched.')
}

main().catch(function(err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
