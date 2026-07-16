import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')
    const status = url.searchParams.get('status')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500)

    let query = context.supabase
      .from('jobs')
      .select('id, company_id, property_address, property_city, property_state, property_zip, owner_name, job_status, noc_status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (companyId) query = query.eq('company_id', companyId)
    if (status) query = query.eq('job_status', status)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, error } = await query
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ jobs: data || [] })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
