import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

/** POST /api/admin/ahj-inspections — add an inspection */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const ahjId = body.ahj_id
    const name = (body.inspection_name || '').trim()

    if (!ahjId || !name) {
      return Response.json({ error: 'ahj_id and inspection_name are required' }, { status: 400 })
    }

    const row = {
      ahj_id: ahjId,
      inspection_name: name,
      description: body.description || null,
      sequence_order: Number.isFinite(Number(body.sequence_order)) ? Number(body.sequence_order) : 0,
      when_to_schedule: body.when_to_schedule || null,
      typical_wait_days: body.typical_wait_days != null ? Number(body.typical_wait_days) : null,
      notes: body.notes || null,
      is_active: body.is_active !== false,
    }

    const { data, error } = await context.supabase
      .from('ahj_inspections')
      .insert(row)
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ inspection: data }, { status: 201 })
  } catch (err) {
    console.error('[admin/ahj-inspections] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
