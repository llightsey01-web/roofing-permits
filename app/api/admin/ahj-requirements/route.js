import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

/** POST /api/admin/ahj-requirements — add a requirement */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const ahjId = body.ahj_id
    const name = (body.name || '').trim()

    if (!ahjId || !name) {
      return Response.json({ error: 'ahj_id and name are required' }, { status: 400 })
    }

    const row = {
      ahj_id: ahjId,
      requirement_type: body.requirement_type || 'document',
      name: name,
      description: body.description || null,
      is_required: body.is_required !== false,
      sequence_order: Number.isFinite(Number(body.sequence_order)) ? Number(body.sequence_order) : 0,
      when_needed: body.when_needed || null,
      download_url: body.download_url || null,
      notes: body.notes || null,
      is_active: body.is_active !== false,
    }

    const { data, error } = await context.supabase
      .from('ahj_requirements')
      .insert(row)
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ requirement: data }, { status: 201 })
  } catch (err) {
    console.error('[admin/ahj-requirements] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
