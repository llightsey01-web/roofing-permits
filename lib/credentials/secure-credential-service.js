import { createClient } from '../supabase-server.js'
import { decryptCredential, encryptCredential } from '../crypto/credential-encryption.js'

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

function decryptStoredPassword(row) {
  if (row.password_encrypted) {
    return decryptCredential(row.password_encrypted)
  }
  if (row.portal_password) {
    return row.portal_password
  }
  return null
}

/**
 * Fetch decrypted AHJ portal credentials for automation (server-side only).
 */
export async function getCredentials(companyId, ahjId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('company_ahj_credentials')
    .select('username, password_encrypted, portal_password')
    .eq('company_id', companyId)
    .eq('ahj_id', ahjId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    throw Object.assign(
      new Error('No credentials found for this company and AHJ'),
      { errorCode: 'missing_credentials' }
    )
  }

  const password = decryptStoredPassword(data)
  if (!password) {
    throw Object.assign(
      new Error('Credentials exist but password is missing or unreadable'),
      { errorCode: 'missing_credentials' }
    )
  }

  return { username: data.username, password }
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

const secureCredentialService = {
  getCredentials,
  listCredentialsForCompany,
  createCredential,
  updateCredential,
  deleteCredential,
}

export default secureCredentialService
