import { createClient } from '../../../../lib/supabase-server.js'

/** GET /api/contractor/products — public catalog of active product approvals */
export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('product_approvals')
      .select(
        'id, manufacturer, product_name, approval_number, fl_approval_number, layer_type, is_active, is_expired, pdf_path, category, subcategory, approval_status'
      )
      .eq('is_active', true)
      .or('is_expired.is.null,is_expired.eq.false')
      .order('manufacturer')
      .order('product_name')

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const products = data || []
    const grouped = {
      primary: products.filter((p) => p.layer_type === 'primary'),
      underlayment: products.filter((p) => p.layer_type === 'underlayment'),
      ventilation: products.filter((p) => p.layer_type === 'ventilation'),
      other: products.filter(
        (p) => !['primary', 'underlayment', 'ventilation'].includes(p.layer_type)
      ),
    }

    return Response.json({ products, grouped, total: products.length })
  } catch (err) {
    console.error('[contractor/products] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
