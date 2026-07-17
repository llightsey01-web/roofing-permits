import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

/** PUT /api/admin/ahj-inspections/[id] — update an inspection */
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

    if (body.inspection_name !== undefined) updates.inspection_name = String(body.inspection_name).trim()
    if (body.description !== undefined) updates.description = body.description
    if (body.sequence_order !== undefined) updates.sequence_order = Number(body.sequence_order) || 0
    if (body.when_to_schedule !== undefined) updates.when_to_schedule = body.when_to_schedule
    if (body.typical_wait_days !== undefined) {
      updates.typical_wait_days =
        body.typical_wait_days === '' || body.typical_wait_days == null
          ? null
          : Number(body.typical_wait_days)
    }
    if (body.notes !== undefined) updates.notes = body.notes
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active)

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await context.supabase
      .from('ahj_inspections')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return Response.json({ error: 'Inspection not found' }, { status: 404 })
    }

    return Response.json({ inspection: data })
  } catch (err) {
    console.error('[admin/ahj-inspections/[id]] PUT error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/** DELETE /api/admin/ahj-inspections/[id] */
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

    const { error } = await context.supabase.from('ahj_inspections').delete().eq('id', id)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[admin/ahj-inspections/[id]] DELETE error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
