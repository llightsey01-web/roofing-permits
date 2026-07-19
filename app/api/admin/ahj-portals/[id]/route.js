import { authenticateRequest, requireSuperAdmin } from '../../../../../lib/auth/session.js'

/** PATCH /api/admin/ahj-portals/[id] — update portal info for AHJ guide */
export async function PATCH(request, { params }) {
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
    const updates = { updated_at: new Date().toISOString() }

    const fields = [
      'office_address',
      'phone',
      'email',
      'office_hours',
      'avg_approval_days',
      'submission_method',
      'portal_tips',
      'portal_url',
      'permit_fee_info',
    ]

    fields.forEach(function (key) {
      if (body[key] !== undefined) {
        if (key === 'avg_approval_days') {
          updates[key] =
            body[key] === '' || body[key] == null ? null : Number(body[key])
        } else {
          updates[key] = body[key]
        }
      }
    })

    console.log('[ahj-portals] Updating table: ahj_portals, id:', id, 'updates:', updates)

    const { data, error } = await context.supabase
      .from('ahj_portals')
      .update(updates)
      .eq('id', id)
      .select(
        `
        id,
        name,
        county_or_city,
        state,
        portal_url,
        submission_method,
        avg_approval_days,
        permit_fee_info,
        portal_tips,
        phone,
        email,
        office_address,
        office_hours
      `
      )
      .single()

    console.log('[ahj-portals] Result:', data?.id, error?.message)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return Response.json({ error: 'AHJ not found' }, { status: 404 })
    }

    return Response.json({ success: true, portal: data })
  } catch (err) {
    console.error('[admin/ahj-portals/[id]] PATCH error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
