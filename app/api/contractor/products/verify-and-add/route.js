import { createRequire } from 'module'
import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

const require = createRequire(import.meta.url)
const { verifyAndAddProduct, detectLayerType } = require('../../../../../lib/products/verify-fl-number.js')

/** POST /api/contractor/products/verify-and-add */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const manufacturer = body.manufacturer
    const productName = body.productName || body.product_name
    const flNumber = body.flNumber || body.fl_number || body.approval_number
    const layerType = body.layerType || body.layer_type || detectLayerType(productName)

    const result = await verifyAndAddProduct({
      manufacturer,
      productName,
      flNumber,
      layerType,
      companyId: context.companyId,
      supabase: context.supabase,
    })

    if (!result.valid) {
      return Response.json({ error: result.error || 'Verification failed', valid: false }, { status: 400 })
    }

    return Response.json({
      success: true,
      valid: true,
      existed: !!result.existed,
      product: result.product,
      message: result.existed
        ? 'Product already in catalog'
        : 'Product verified on Florida Building Commission and added',
    })
  } catch (err) {
    console.error('[contractor/products/verify-and-add] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
