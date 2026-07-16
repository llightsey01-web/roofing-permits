import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

export async function GET(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const { data: company, error } = await context.supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    const [{ data: jobs }, { data: credentials }] = await Promise.all([
      context.supabase
        .from('jobs')
        .select('id, property_address, job_status, noc_status, created_at, updated_at, owner_name')
        .eq('company_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      context.supabase
        .from('company_credentials')
        .select('id, provider, credential_type, is_active, ahj_id, created_at')
        .eq('company_id', id),
    ])

    return Response.json({
      company,
      jobs: jobs || [],
      credentials: credentials || [],
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const body = await request.json()
    const allowed = [
      'name', 'dba_name', 'primary_email', 'phone', 'address', 'city', 'state', 'zip',
      'license_number', 'qualifier_name', 'qualifier_license', 'notes',
      'subscription_plan', 'subscription_status', 'onboarding_status', 'is_active',
      'review_gates', 'trial_ends_at',
    ]
    const updates = {}
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await context.supabase
      .from('companies')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ company: data })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const { data, error } = await context.supabase
      .from('companies')
      .update({
        is_active: false,
        subscription_status: 'suspended',
        onboarding_status: 'suspended',
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ company: data, suspended: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
