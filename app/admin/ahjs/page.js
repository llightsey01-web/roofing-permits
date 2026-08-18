import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '../../../lib/supabase-server.js'
import { isValidCompanyId } from '../../../lib/auth/session.js'
import AhjDashboardClient from './AhjDashboardClient.jsx'

const { loadAhjDashboardRows } = require('../../../lib/ahj/ahj-readiness-dashboard.js')

async function requireSuperAdminServerContext() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only RSC path — session refresh writes are handled by client shell.
        },
      },
    }
  )

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, role, company_id, email')
    .eq('id', user.id)
    .single()

  if (userError || !userData || userData.role !== 'super_admin') {
    redirect('/contractor/dashboard')
  }

  return {
    user,
    userData,
    serviceSupabase: createServiceClient(),
  }
}

export default async function AdminAhjsPage() {
  const context = await requireSuperAdminServerContext()

  // Super admins often have null company_id. Only pass company scope when a
  // valid UUID is present on the authenticated users row — never invent one.
  const companyId = isValidCompanyId(context.userData.company_id)
    ? context.userData.company_id
    : null

  const rows = await loadAhjDashboardRows(
    context.serviceSupabase,
    companyId ? { companyId: companyId } : {}
  )

  const credentialScopeNote = companyId
    ? 'Credential columns use company scope for the signed-in admin user company.'
    : 'Credential columns use platform scope (any company). Detail API refresh is also platform-scoped.'

  return (
    <AhjDashboardClient
      initialRows={rows || []}
      credentialScopeNote={credentialScopeNote}
    />
  )
}
