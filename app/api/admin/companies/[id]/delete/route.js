import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

/**
 * Find a Supabase Auth user by email (paginated listUsers).
 */
async function findAuthUserByEmail(supabase, email) {
  const want = String(email || '').trim().toLowerCase()
  if (!want) return null

  let page = 1
  const perPage = 200
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: page, perPage: perPage })
    if (error) {
      console.error('[delete-company] listUsers failed:', error.message)
      return null
    }
    const users = data?.users || []
    const match = users.find(function (u) {
      return String(u.email || '').trim().toLowerCase() === want
    })
    if (match) return match
    if (users.length < perPage) break
    page += 1
  }
  return null
}

async function deleteAuthUserBulletproof(supabase, userRow) {
  const email = userRow.email || null
  const id = userRow.id

  try {
    const { error: authError } = await supabase.auth.admin.deleteUser(id)
    if (!authError) {
      console.log('[delete] Deleted auth user:', email || id)
      return true
    }

    console.error('[delete] Auth delete failed for', email, ':', authError.message)

    if (email) {
      const authUser = await findAuthUserByEmail(supabase, email)
      if (authUser) {
        const { error: retryError } = await supabase.auth.admin.deleteUser(authUser.id)
        if (!retryError) {
          console.log('[delete] Deleted auth user by email:', email)
          return true
        }
        console.error('[delete] Auth delete by email failed for', email, ':', retryError.message)
      } else {
        console.warn('[delete] No auth user found by email:', email)
      }
    }
    return false
  } catch (e) {
    console.error('[delete] Auth delete exception for', email || id, ':', e.message)
    return false
  }
}

/**
 * Hard-delete a company and related data.
 * DELETE /api/admin/companies/[id]/delete
 */
export async function DELETE(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id: companyId } = await params
    if (!companyId) {
      return Response.json({ error: 'Company id is required' }, { status: 400 })
    }

    const supabase = context.supabase

    const { data: company, error: companyLookupError } = await supabase
      .from('companies')
      .select('id, name, primary_email')
      .eq('id', companyId)
      .maybeSingle()

    if (companyLookupError) {
      return Response.json({ error: companyLookupError.message }, { status: 500 })
    }
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    // Step 1 — Get all users for this company BEFORE deleting anything
    const { data: companyUsers, error: usersError } = await supabase
      .from('users')
      .select('id, email')
      .eq('company_id', companyId)

    if (usersError) {
      console.warn('[delete] users lookup failed:', usersError.message)
    }
    console.log('[delete] Found', companyUsers?.length || 0, 'users to delete')

    // Step 2 — Delete from Supabase Auth FIRST (before deleting from users table)
    for (const u of companyUsers || []) {
      await deleteAuthUserBulletproof(supabase, u)
    }

    // If no users row but company has a primary email, still clear stuck auth
    if ((!companyUsers || companyUsers.length === 0) && company.primary_email) {
      const orphan = await findAuthUserByEmail(supabase, company.primary_email)
      if (orphan) {
        console.log('[delete] Found orphaned auth user by company email:', company.primary_email)
        await deleteAuthUserBulletproof(supabase, { id: orphan.id, email: orphan.email })
      }
    }

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('company_id', companyId)
    const jobIds = (jobs || []).map(function (j) { return j.id })

    let runIds = []
    if (jobIds.length > 0) {
      const { data: runsByJob } = await supabase
        .from('automation_runs')
        .select('id')
        .in('job_id', jobIds)
      runIds = (runsByJob || []).map(function (r) { return r.id })
    }

    const { data: runsByCompany } = await supabase
      .from('automation_runs')
      .select('id')
      .eq('company_id', companyId)
    const extraRunIds = (runsByCompany || []).map(function (r) { return r.id })
    runIds = Array.from(new Set(runIds.concat(extraRunIds)))

    async function ignoreMissing(label, promise) {
      const { error } = await promise
      if (error) {
        console.warn('[delete-company] ' + label + ':', error.message)
      }
    }

    if (runIds.length > 0) {
      await ignoreMissing(
        'automation_logs',
        supabase.from('automation_logs').delete().in('run_id', runIds)
      )
    }

    await ignoreMissing(
      'run_actions by company',
      supabase.from('run_actions').delete().eq('company_id', companyId)
    )
    if (jobIds.length > 0) {
      await ignoreMissing(
        'run_actions by job',
        supabase.from('run_actions').delete().in('job_id', jobIds)
      )
    }

    if (jobIds.length > 0) {
      await ignoreMissing(
        'automation_runs by job',
        supabase.from('automation_runs').delete().in('job_id', jobIds)
      )
    }
    await ignoreMissing(
      'automation_runs by company',
      supabase.from('automation_runs').delete().eq('company_id', companyId)
    )

    if (jobIds.length > 0) {
      await ignoreMissing(
        'job_documents',
        supabase.from('job_documents').delete().in('job_id', jobIds)
      )
    }

    if (jobIds.length > 0) {
      await ignoreMissing(
        'review_requests by job',
        supabase.from('review_requests').delete().in('job_id', jobIds)
      )
    }
    await ignoreMissing(
      'review_requests by company',
      supabase.from('review_requests').delete().eq('company_id', companyId)
    )

    await ignoreMissing(
      'jobs',
      supabase.from('jobs').delete().eq('company_id', companyId)
    )

    await ignoreMissing(
      'company_credentials',
      supabase.from('company_credentials').delete().eq('company_id', companyId)
    )
    await ignoreMissing(
      'company_ahj_credentials',
      supabase.from('company_ahj_credentials').delete().eq('company_id', companyId)
    )

    await ignoreMissing(
      'company_materials',
      supabase.from('company_materials').delete().eq('company_id', companyId)
    )

    await ignoreMissing(
      'system_alerts',
      supabase.from('system_alerts').delete().eq('company_id', companyId)
    )

    await ignoreMissing(
      'audit_log',
      supabase.from('audit_log').delete().eq('company_id', companyId)
    )

    // Step 3 — Now delete from users table
    await ignoreMissing(
      'users',
      supabase.from('users').delete().eq('company_id', companyId)
    )

    const { error } = await supabase.from('companies').delete().eq('id', companyId)
    if (error) {
      console.error('[delete-company] Failed:', error.message)
      return Response.json({ error: 'Failed to delete company: ' + error.message }, { status: 500 })
    }

    console.log('[delete-company] Deleted company:', companyId, company.name)
    return Response.json({ success: true, companyId: companyId, name: company.name })
  } catch (err) {
    console.error('[delete-company] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
