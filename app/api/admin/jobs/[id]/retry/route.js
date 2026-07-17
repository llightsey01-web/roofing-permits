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

    const { data: latestRun } = await context.supabase
      .from('automation_runs')
      .select('*')
      .eq('job_id', id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestRun) {
      return Response.json({ error: 'No automation run found for this job' }, { status: 404 })
    }

    const { data: updated, error } = await context.supabase
      .from('automation_runs')
      .update({
        run_status: 'queued',
        error_message: null,
        attempts: 0,
        started_at: new Date().toISOString(),
        payload: Object.assign({}, latestRun.payload || {}, {
          retried_at: new Date().toISOString(),
          retried_by: context.user?.id || null,
          run_type_override: body.run_type || null,
        }),
      })
      .eq('id', latestRun.id)
      .select('*')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    if (body.run_type && body.run_type !== latestRun.run_type) {
      await context.supabase
        .from('automation_runs')
        .update({ run_type: body.run_type })
        .eq('id', latestRun.id)
    }

    await context.supabase.from('jobs').update({
      job_status: 'automation_running',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    return Response.json({ success: true, run: updated })
  } catch (err) {
    console.error('[admin/jobs/retry]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
