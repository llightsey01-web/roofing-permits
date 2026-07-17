import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

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
      .select('id, name')
      .eq('id', companyId)
      .maybeSingle()

    if (companyLookupError) {
      return Response.json({ error: companyLookupError.message }, { status: 500 })
    }
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
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
        // Table may not exist in all environments — log and continue
        console.warn('[delete-company] ' + label + ':', error.message)
      }
    }

    // 1. automation_logs
    if (runIds.length > 0) {
      await ignoreMissing(
        'automation_logs',
        supabase.from('automation_logs').delete().in('run_id', runIds)
      )
    }

    // 2. run_actions
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

    // 3. automation_runs
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

    // 4. job_documents
    if (jobIds.length > 0) {
      await ignoreMissing(
        'job_documents',
        supabase.from('job_documents').delete().in('job_id', jobIds)
      )
    }

    // 5. review_requests (job-scoped and company-scoped if present)
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

    // 6. jobs
    await ignoreMissing(
      'jobs',
      supabase.from('jobs').delete().eq('company_id', companyId)
    )

    // 7. credentials
    await ignoreMissing(
      'company_credentials',
      supabase.from('company_credentials').delete().eq('company_id', companyId)
    )
    await ignoreMissing(
      'company_ahj_credentials',
      supabase.from('company_ahj_credentials').delete().eq('company_id', companyId)
    )

    // 8. company materials
    await ignoreMissing(
      'company_materials',
      supabase.from('company_materials').delete().eq('company_id', companyId)
    )

    // 9. system alerts
    await ignoreMissing(
      'system_alerts',
      supabase.from('system_alerts').delete().eq('company_id', companyId)
    )

    // 10. audit log
    await ignoreMissing(
      'audit_log',
      supabase.from('audit_log').delete().eq('company_id', companyId)
    )

    // 11. users (auth + profile)
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', companyId)

    for (const u of users || []) {
      try {
        const { error: authDeleteError } = await supabase.auth.admin.deleteUser(u.id)
        if (authDeleteError) {
          console.warn('[delete-company] auth delete ' + u.id + ':', authDeleteError.message)
        }
      } catch (authErr) {
        console.warn('[delete-company] auth delete exception:', authErr.message)
      }
    }

    await ignoreMissing(
      'users',
      supabase.from('users').delete().eq('company_id', companyId)
    )

    // 12. company
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
