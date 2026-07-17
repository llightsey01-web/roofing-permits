import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const body = await request.json().catch(function () { return {} })
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

    const { data: job, error: jobError } = await context.supabase
      .from('jobs')
      .update({
        job_status: 'needs_review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, company_id, property_address, property_city, property_state, owner_name')
      .single()

    if (jobError || !job) {
      return Response.json({ error: jobError?.message || 'Job not found' }, { status: 404 })
    }

    await context.supabase.from('automation_runs').update({
      run_status: 'needs_review',
      error_message: notes || 'Escalated to manual review',
      completed_at: new Date().toISOString(),
    }).eq('job_id', id).eq('run_status', 'running')

    try {
      const { sendAlert } = require('../../../../../../lib/monitoring/alert-service')
      await sendAlert({
        type: 'automation_failed',
        severity: 'warning',
        jobId: job.id,
        companyId: job.company_id,
        message: 'Job escalated to manual review',
        details: {
          propertyAddress: [job.property_address, job.property_city, job.property_state].filter(Boolean).join(', '),
          notes: notes || null,
          escalatedBy: context.userData?.email || context.user?.email || null,
        },
      })
    } catch (alertErr) {
      console.warn('[escalate] alert failed:', alertErr.message)
    }

    return Response.json({ success: true, job: job })
  } catch (err) {
    console.error('[admin/jobs/escalate]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
