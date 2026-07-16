import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: companies, error } = await context.supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const { data: jobs } = await context.supabase.from('jobs').select('company_id')
    const counts = {}
    ;(jobs || []).forEach(j => {
      if (!j.company_id) return
      counts[j.company_id] = (counts[j.company_id] || 0) + 1
    })

    const withCounts = (companies || []).map(c => ({
      ...c,
      jobs_count: counts[c.id] || 0,
    }))

    return Response.json({ companies: withCounts })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  // Prefer /api/admin/onboard for full onboarding; keep simple create here
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await context.supabase
      .from('companies')
      .insert({
        name,
        primary_email: body.primary_email || null,
        phone: body.phone || null,
        address: body.address || null,
        city: body.city || null,
        state: body.state || 'FL',
        zip: body.zip || null,
        license_number: body.license_number || null,
        qualifier_name: body.qualifier_name || null,
        qualifier_license: body.qualifier_license || null,
        is_active: true,
        onboarding_status: 'pending',
        subscription_plan: body.subscription_plan || 'starter',
        subscription_status: 'trial',
      })
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
