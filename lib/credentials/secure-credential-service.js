import { createRequire } from 'module'
import { createClient } from '../supabase-server.js'
import { decryptCredential, encryptCredential, isEncryptionConfigured } from '../crypto/credential-encryption.js'

const require = createRequire(import.meta.url)
const { getCredential } = require('./credential-loader.js')
const { providerForPortal } = require('../ahj/county-options.js')

const PUBLIC_CREDENTIAL_FIELDS = `
  id,
  company_id,
  ahj_id,
  username,
  notes,
  is_active,
  created_at,
  updated_at,
  ahj_portals ( id, name, county_or_city )
`

const PUBLIC_VAULT_FIELDS = `
  id,
  company_id,
  provider,
  ahj_id,
  credential_type,
  encrypted_username,
  encrypted_password,
  encrypted_extra,
  is_active,
  created_at,
  updated_at,
  last_used_at,
  ahj_portals ( id, name, county_or_city )
`

function inferCredentialType(provider) {
  if (provider === 'epn') return 'erecord'
  if (provider === 'proof') return 'proof'
  if (provider === 'twocaptcha') return 'api_key'
  return 'ahj_portal'
}

function mapPublicCredential(row) {
  if (!row) return null
  return {
    id: row.id,
    company_id: row.company_id,
    ahj_id: row.ahj_id,
    username: row.username,
    notes: row.notes || '',
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ahj_name: row.ahj_portals?.name || null,
    ahj_county: row.ahj_portals?.county_or_city || null,
    has_password: Boolean(row.password_encrypted || row.portal_password),
    password_masked: '••••••••••',
  }
}

function mapPublicVaultCredential(row) {
  if (!row) return null
  var username = null
  if (row.encrypted_username) {
    try {
      username = decryptCredential(row.encrypted_username)
    } catch (e) {
      username = null
    }
  }
  return {
    id: row.id,
    company_id: row.company_id,
    provider: row.provider,
    ahj_id: row.ahj_id,
    credential_type: row.credential_type,
    username: username,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    ahj_name: row.ahj_portals?.name || null,
    ahj_county: row.ahj_portals?.county_or_city || null,
    has_username: Boolean(row.encrypted_username),
    has_password: Boolean(row.encrypted_password || row.encrypted_extra),
    password_masked: '••••••••••',
  }
}

function decryptStoredPassword(row) {
  if (row.password_encrypted) {
    return decryptCredential(row.password_encrypted)
  }
  if (row.portal_password) {
    return row.portal_password
  }
  return null
}

function fallbackProviderFromPortal(portal) {
  if (!portal) return null
  if (portal.credential_key) {
    const key = String(portal.credential_key).toLowerCase().trim()
    if (key.includes('polk')) return 'polk_accela'
    if (key.includes('lee')) return 'lee_accela'
  }
  const name = String(portal.name || portal.county_or_city || '').toLowerCase()
  if (name.includes('polk')) return 'polk_accela'
  if (name.includes('lee')) return 'lee_accela'
  const slug = name.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug ? slug + '_portal' : null
}

/**
 * Fetch decrypted AHJ portal credentials for automation (server-side only).
 * Vault-first (company_credentials) via 3-tier credential-loader, then
 * legacy company_ahj_credentials fallback. Never dual-writes.
 */
export async function getCredentials(companyId, ahjId) {
  if (!companyId || !ahjId) {
    throw Object.assign(
      new Error('No credentials found for this company and AHJ'),
      { errorCode: 'missing_credentials' }
    )
  }

  const supabase = createClient()
  const { data: portal } = await supabase
    .from('ahj_portals')
    .select('id, name, county_or_city, credential_key')
    .eq('id', ahjId)
    .maybeSingle()

  const provider = providerForPortal(portal) || fallbackProviderFromPortal(portal)

  if (provider) {
    try {
      const vaultOrTier = await getCredential({
        provider,
        companyId,
        ahjId,
      })
      if (vaultOrTier?.username && vaultOrTier?.password) {
        return {
          username: vaultOrTier.username,
          password: vaultOrTier.password,
          source: 'vault_or_loader',
          provider,
        }
      }
    } catch (loaderErr) {
      // Fall through to explicit legacy read below
      console.warn(
        '[credentials] loader miss for',
        provider,
        ahjId,
        '—',
        loaderErr.message
      )
    }
  }

  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, password_encrypted, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(
      new Error('No credentials found for this company and AHJ'),
      { errorCode: 'missing_credentials' }
    )
  }

  const password = decryptStoredPassword(data)
  if (!password || !data.username) {
    throw Object.assign(
      new Error('Credentials exist but password is missing or unreadable'),
      { errorCode: 'missing_credentials' }
    )
  }

  return { username: data.username, password, source: 'legacy' }
}

/**
 * List credentials for a company — never returns decrypted passwords.
 */
export async function listCredentialsForCompany(companyId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select(PUBLIC_CREDENTIAL_FIELDS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error('Failed to load credentials: ' + error.message)
  }

  return (data || []).map(mapPublicCredential)
}

export async function listVaultCredentialsForCompany(companyId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('company_credentials')
    .select(PUBLIC_VAULT_FIELDS)
    .eq('company_id', companyId)
    .order('provider', { ascending: true })

  if (error) {
    throw new Error('Failed to load vault credentials: ' + error.message)
  }

  return (data || []).map(mapPublicVaultCredential)
}

export async function saveCredential({ companyId, provider, ahjId, username, password, extra, credentialType }) {
  if (!isEncryptionConfigured()) {
    throw Object.assign(new Error('Credential encryption is not configured on the server'), { status: 503 })
  }
  if (!companyId || !provider) {
    throw Object.assign(new Error('companyId and provider are required'), { status: 400 })
  }
  if (!password && !username && !extra) {
    throw Object.assign(new Error('username, password, or extra is required'), { status: 400 })
  }

  const supabase = createClient()
  const now = new Date().toISOString()
  const row = {
    company_id: companyId,
    provider,
    ahj_id: ahjId || null,
    credential_type: credentialType || inferCredentialType(provider),
    encrypted_username: username ? encryptCredential(username) : null,
    encrypted_password: password ? encryptCredential(password) : null,
    encrypted_extra: extra
      ? Object.fromEntries(
          Object.entries(extra).map(([key, value]) => [key, value ? encryptCredential(String(value)) : null])
        )
      : null,
    is_active: true,
    updated_at: now,
    last_used_at: now,
  }

  let existingQuery = supabase
    .from('company_credentials')
    .select('id')
    .eq('company_id', companyId)
    .eq('provider', provider)

  if (ahjId) {
    existingQuery = existingQuery.eq('ahj_id', ahjId)
  } else {
    existingQuery = existingQuery.is('ahj_id', null)
  }

  const { data: existing, error: fetchError } = await existingQuery.maybeSingle()

  if (fetchError) {
    throw new Error('Failed to lookup vault credential: ' + fetchError.message)
  }

  let data
  let error

  if (existing?.id) {
    ;({ data, error } = await supabase
      .from('company_credentials')
      .update(row)
      .eq('id', existing.id)
      .select(PUBLIC_VAULT_FIELDS)
      .single())
  } else {
    row.created_at = now
    ;({ data, error } = await supabase
      .from('company_credentials')
      .insert(row)
      .select(PUBLIC_VAULT_FIELDS)
      .single())
  }

  if (error) {
    throw new Error('Failed to save vault credential: ' + error.message)
  }

  return mapPublicVaultCredential(data)
}

export async function createCredential({ companyId, ahjId, username, password, notes }) {
  const supabase = createClient()
  const now = new Date().toISOString()
  const passwordEncrypted = encryptCredential(password)

  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .insert({
      company_id: companyId,
      ahj_id: ahjId,
      username,
      password_encrypted: passwordEncrypted,
      portal_password: null,
      notes: notes || null,
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select(PUBLIC_CREDENTIAL_FIELDS)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('Credentials already exist for this AHJ'), { status: 409 })
    }
    throw new Error('Failed to save credential: ' + error.message)
  }

  return mapPublicCredential(data)
}

export async function updateCredential({ credentialId, companyId, username, password, notes }) {
  const supabase = createClient()

  const { data: existing, error: fetchError } = await supabase
    .from('company_ahj_credentials')
    .select('id, company_id')
    .eq('id', credentialId)
    .single()

  if (fetchError || !existing || existing.company_id !== companyId) {
    throw Object.assign(new Error('Credential not found'), { status: 404 })
  }

  const updates = {
    updated_at: new Date().toISOString(),
  }

  if (username !== undefined) updates.username = username
  if (notes !== undefined) updates.notes = notes || null
  if (password) {
    updates.password_encrypted = encryptCredential(password)
    updates.portal_password = null
  }

  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .update(updates)
    .eq('id', credentialId)
    .eq('company_id', companyId)
    .select(PUBLIC_CREDENTIAL_FIELDS)
    .single()

  if (error) {
    throw new Error('Failed to update credential: ' + error.message)
  }

  return mapPublicCredential(data)
}

export async function deleteCredential(credentialId, companyId) {
  const supabase = createClient()
  const { error } = await supabase
    .from('company_ahj_credentials')
    .delete()
    .eq('id', credentialId)
    .eq('company_id', companyId)

  if (error) {
    throw new Error('Failed to delete credential: ' + error.message)
  }
}

export async function deleteVaultCredential(credentialId, companyId) {
  const supabase = createClient()
  const { data: existing, error: fetchError } = await supabase
    .from('company_credentials')
    .select('id, company_id')
    .eq('id', credentialId)
    .maybeSingle()

  if (fetchError) {
    throw new Error('Failed to lookup vault credential: ' + fetchError.message)
  }
  if (!existing || existing.company_id !== companyId) {
    throw Object.assign(new Error('Credential not found'), { status: 404 })
  }

  const { error } = await supabase
    .from('company_credentials')
    .delete()
    .eq('id', credentialId)
    .eq('company_id', companyId)

  if (error) {
    throw new Error('Failed to delete vault credential: ' + error.message)
  }
}

const secureCredentialService = {
  getCredentials,
  listCredentialsForCompany,
  listVaultCredentialsForCompany,
  saveCredential,
  createCredential,
  updateCredential,
  deleteCredential,
  deleteVaultCredential,
}

export default secureCredentialService
