import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

/** DELETE /api/contractor/materials/[id] */
export async function DELETE(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 })
    }

    const { data: existing, error: findError } = await context.supabase
      .from('company_materials')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()

    if (findError) {
      return Response.json({ error: findError.message }, { status: 500 })
    }
    if (!existing || existing.company_id !== context.companyId) {
      return Response.json({ error: 'Material preference not found' }, { status: 404 })
    }

    const { error } = await context.supabase.from('company_materials').delete().eq('id', id)
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('[contractor/materials/[id]] DELETE error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
