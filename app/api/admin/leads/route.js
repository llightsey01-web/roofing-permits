import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status')

    let query = context.supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ leads: data || [] })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const id = body.id
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const updates = {}
    if (body.status) updates.status = body.status
    if (body.notes !== undefined) updates.notes = body.notes
    if (body.converted_company_id !== undefined) updates.converted_company_id = body.converted_company_id
    if (body.status === 'contacted') updates.contacted_at = new Date().toISOString()

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await context.supabase
      .from('leads')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ lead: data })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
