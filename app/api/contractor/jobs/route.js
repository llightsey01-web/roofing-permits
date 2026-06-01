import { authenticateRequest, requireCompanyUser, filterJobsByCompany } from '../../../../lib/auth/session.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: jobs, error } = await context.userSupabase
      .from('jobs')
      .select('id, company_id, owner_name, property_address, property_city, property_state, property_zip, job_status, noc_status, roof_type, valuation, created_at')
      .eq('company_id', context.companyId)
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const scopedJobs = filterJobsByCompany(jobs, context.companyId)

    return Response.json({
      jobs: scopedJobs,
      companyId: context.companyId,
    })
  } catch (err) {
    console.error('List contractor jobs error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()

    const { data: job, error: jobError } = await context.userSupabase
      .from('jobs')
      .insert({
        owner_name: body.owner_name,
        owner_email: body.owner_email || null,
        owner_phone: body.owner_phone || null,
        property_address: body.property_address,
        property_city: body.property_city,
        property_state: body.property_state || 'FL',
        property_zip: body.property_zip,
        scope_of_work: body.scope_of_work || null,
        roof_type: body.roof_type || null,
        valuation: body.valuation ? parseFloat(body.valuation) : null,
        internal_notes: body.notes || body.internal_notes || null,
        ahj_id: body.ahj_id || null,
        company_id: context.companyId,
        created_by: context.user.id,
        job_status: 'ready',
        noc_status: 'not_started',
        material_manufacturer: body.roof_specs?.primary_material?.manufacturer || null,
        material_model: body.roof_specs?.primary_material?.product_name || null,
        material_approval_num: body.roof_specs?.primary_material?.approval_number || null,
        roof_specs: body.roof_specs || {},
        job_specs: {
          ...(body.job_specs || {}),
          squares: body.squares || body.job_specs?.squares || null,
        },
      })
      .select()
      .single()

    if (jobError) {
      console.error('Contractor job save error:', jobError.message)
      return Response.json({ error: jobError.message }, { status: 500 })
    }

    if (job.company_id !== context.companyId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: runError } = await context.supabase
      .from('automation_runs')
      .insert({
        job_id: job.id,
        run_status: 'queued',
        started_at: new Date().toISOString(),
      })

    if (runError) {
      console.error('AUTOMATION QUEUE FAILED:', runError.message)
    }

    const { error: statusError } = await context.supabase
      .from('jobs')
      .update({ job_status: 'automation_running' })
      .eq('id', job.id)

    if (statusError) {
      console.error('Failed to update job status:', statusError.message)
    }

    return Response.json({ success: true, job: { ...job, job_status: 'automation_running' } }, { status: 201 })
  } catch (err) {
    console.error('Contractor job creation error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
