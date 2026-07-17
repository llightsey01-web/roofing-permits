import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

/** PUT /api/admin/ahj-requirements/[id] — update a requirement */
export async function PUT(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const body = await request.json()
    const updates = {}

    if (body.name !== undefined) updates.name = String(body.name).trim()
    if (body.requirement_type !== undefined) updates.requirement_type = body.requirement_type
    if (body.description !== undefined) updates.description = body.description
    if (body.is_required !== undefined) updates.is_required = Boolean(body.is_required)
    if (body.sequence_order !== undefined) updates.sequence_order = Number(body.sequence_order) || 0
    if (body.when_needed !== undefined) updates.when_needed = body.when_needed
    if (body.download_url !== undefined) updates.download_url = body.download_url || null
    if (body.notes !== undefined) updates.notes = body.notes
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active)

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await context.supabase
      .from('ahj_requirements')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return Response.json({ error: 'Requirement not found' }, { status: 404 })
    }

    return Response.json({ requirement: data })
  } catch (err) {
    console.error('[admin/ahj-requirements/[id]] PUT error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/** DELETE /api/admin/ahj-requirements/[id] */
export async function DELETE(_request, { params }) {
  try {
    let context = await authenticateRequest(_request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const { error } = await context.supabase.from('ahj_requirements').delete().eq('id', id)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[admin/ahj-requirements/[id]] DELETE error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
