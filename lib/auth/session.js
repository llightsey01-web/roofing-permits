import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient as createServiceClient } from '../supabase-server.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createUserClient(accessToken) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}

export function isValidCompanyId(companyId) {
  return typeof companyId === 'string' && UUID_RE.test(companyId)
}

export function normalizeCompanyId(companyId) {
  return typeof companyId === 'string' ? companyId.trim().toLowerCase() : ''
}

export function filterJobsByCompany(jobs, companyId) {
  const expected = normalizeCompanyId(companyId)
  if (!expected) return []
  return (jobs || []).filter(job => normalizeCompanyId(job.company_id) === expected)
}

/**
 * Authenticate a request via Bearer token and load app user context.
 */
export async function authenticateRequest(request) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401 }
  }

  const accessToken = authHeader.replace('Bearer ', '').trim()
  if (!accessToken) {
    return { error: 'Unauthorized', status: 401 }
  }

  const userSupabase = createUserClient(accessToken)
  const { data: { user }, error: authError } = await userSupabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Unauthorized', status: 401 }
  }

  const { data: userData, error: userError } = await userSupabase
    .from('users')
    .select('id, role, company_id, email, full_name')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    return { error: 'User profile not found', status: 403 }
  }

  const companyId = userData.company_id || null

  return {
    user,
    userData,
    accessToken,
    userSupabase,
    supabase: createServiceClient(),
    isSuperAdmin: userData.role === 'super_admin',
    isCompanyAdmin: userData.role === 'company_admin',
    companyId,
  }
}

export async function requireCompanyUser(context) {
  if (context.error) return context

  if (context.isSuperAdmin) {
    return { error: 'Contractor access only', status: 403 }
  }

  if (!context.isCompanyAdmin) {
    return { error: 'Contractor role required', status: 403 }
  }

  if (!isValidCompanyId(context.companyId)) {
    return { error: 'No valid company associated with this account', status: 403 }
  }

  return context
}

export async function assertJobAccess(supabase, jobId, companyId) {
  if (!isValidCompanyId(companyId)) {
    return { error: 'Forbidden', status: 403 }
  }

  const expectedCompanyId = normalizeCompanyId(companyId)

  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, company_id')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    return { error: 'Job lookup failed', status: 500 }
  }

  if (!job || normalizeCompanyId(job.company_id) !== expectedCompanyId) {
    return { error: 'Job not found', status: 404 }
  }

  return { job }
}
