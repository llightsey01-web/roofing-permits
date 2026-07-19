import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = [
  'name',
  'description',
  'is_required',
  'sequence_order',
  'when_needed',
  'download_url',
  'notes',
  'is_active',
  'requirement_type',
]

function pickUpdates(body) {
  const updates = {}
  for (let i = 0; i < ALLOWED_FIELDS.length; i++) {
    const key = ALLOWED_FIELDS[i]
    if (body[key] === undefined) continue
    if (key === 'name') {
      updates.name = String(body.name).trim()
    } else if (key === 'is_required' || key === 'is_active') {
      updates[key] = Boolean(body[key])
    } else if (key === 'sequence_order') {
      updates.sequence_order = Number(body.sequence_order) || 0
    } else if (key === 'download_url') {
      updates.download_url = body.download_url || null
    } else {
      updates[key] = body[key]
    }
  }
  return updates
}

async function updateRequirement(request, params) {
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
  const updates = pickUpdates(body)

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
    console.error('[ahj-requirements] Update failed:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: 'Requirement not found' }, { status: 404 })
  }

  console.log('[ahj-requirements] Updated:', id, updates)
  return Response.json({ success: true, requirement: data })
}

/** PUT /api/admin/ahj-requirements/[id] — update a requirement */
export async function PUT(request, { params }) {
  try {
    return await updateRequirement(request, params)
  } catch (err) {
    console.error('[admin/ahj-requirements/[id]] PUT error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/** PATCH /api/admin/ahj-requirements/[id] — same as PUT */
export async function PATCH(request, { params }) {
  try {
    return await updateRequirement(request, params)
  } catch (err) {
    console.error('[admin/ahj-requirements/[id]] PATCH error:', err.message)
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
