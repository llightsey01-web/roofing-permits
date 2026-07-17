import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'

export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const body = await request.json().catch(function () { return {} })
    const resumeFromStep = body.resume_from_step || body.resumeFromStep || null

    const { data: job, error: jobError } = await context.supabase
      .from('jobs')
      .select('id, company_id, job_status')
      .eq('id', id)
      .single()

    if (jobError || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    // Prefer resuming the latest errored/running run; otherwise queue a new one
    const { data: latestRun } = await context.supabase
      .from('automation_runs')
      .select('*')
      .eq('job_id', id)
      .in('run_status', ['error', 'running', 'needs_review'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let run = null
    if (latestRun) {
      const payload = Object.assign({}, latestRun.payload || {}, {
        resume_from_step: resumeFromStep,
        resumed_at: new Date().toISOString(),
        resumed_by: context.user?.id || null,
      })
      const { data: updated, error: updateError } = await context.supabase
        .from('automation_runs')
        .update({
          run_status: 'queued',
          error_message: null,
          payload: payload,
          started_at: new Date().toISOString(),
        })
        .eq('id', latestRun.id)
        .select('*')
        .single()
      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 })
      }
      run = updated
    } else {
      const { data: inserted, error: insertError } = await context.supabase
        .from('automation_runs')
        .insert({
          job_id: id,
          company_id: job.company_id,
          run_type: body.run_type || 'permit_phase_1',
          run_status: 'queued',
          payload: { resume_from_step: resumeFromStep },
          started_at: new Date().toISOString(),
          attempts: 0,
        })
        .select('*')
        .single()
      if (insertError) {
        return Response.json({ error: insertError.message }, { status: 500 })
      }
      run = inserted
    }

    await context.supabase.from('jobs').update({
      job_status: 'automation_running',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    return Response.json({ success: true, run: run })
  } catch (err) {
    console.error('[admin/jobs/resume]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
