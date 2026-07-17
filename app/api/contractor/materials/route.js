import { authenticateRequest, requireCompanyUser } from '../../../../lib/auth/session.js'

/** GET /api/contractor/materials — company material preferences */
export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data, error } = await context.supabase
      .from('company_materials')
      .select(
        `
        id,
        company_id,
        product_approval_id,
        layer_type,
        is_default,
        created_at,
        product:product_approvals (
          id,
          manufacturer,
          product_name,
          approval_number,
          fl_approval_number,
          layer_type,
          is_active,
          is_expired,
          pdf_path
        )
      `
      )
      .eq('company_id', context.companyId)
      .order('created_at', { ascending: true })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const materials = data || []
    const grouped = {
      primary: materials.filter((m) => m.layer_type === 'primary'),
      underlayment: materials.filter((m) => m.layer_type === 'underlayment'),
      ventilation: materials.filter((m) => m.layer_type === 'ventilation'),
    }

    return Response.json({ materials, grouped, companyId: context.companyId })
  } catch (err) {
    console.error('[contractor/materials] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/** POST /api/contractor/materials — upsert preference list */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const items = Array.isArray(body.materials)
      ? body.materials
      : Array.isArray(body)
        ? body
        : null

    if (!items) {
      return Response.json({ error: 'materials array is required' }, { status: 400 })
    }

    // Spec: replace full preference set for the company
    await context.supabase.from('company_materials').delete().eq('company_id', context.companyId)

    const rows = []
    for (const item of items) {
      const productApprovalId = item.productApprovalId || item.product_approval_id
      const layerType = item.layerType || item.layer_type
      if (!productApprovalId || !layerType) continue
      rows.push({
        company_id: context.companyId,
        product_approval_id: productApprovalId,
        layer_type: layerType,
        is_default: item.isDefault === true || item.is_default === true,
      })
    }

    if (rows.length === 0) {
      return Response.json({ success: true, materials: [] })
    }

    const { data, error } = await context.supabase
      .from('company_materials')
      .insert(rows)
      .select(
        `
        id,
        company_id,
        product_approval_id,
        layer_type,
        is_default,
        created_at,
        product:product_approvals (
          id, manufacturer, product_name, approval_number, fl_approval_number, layer_type
        )
      `
      )

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, materials: data || [] })
  } catch (err) {
    console.error('[contractor/materials] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
