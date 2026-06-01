import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

const DEFAULT_REVIEW_GATES = {
  noc_before_send: false,
  permit_before_submit: false,
  auto_approve_all: true,
}

function normalizeReviewGates(raw) {
  const gates = raw && typeof raw === 'object' ? raw : {}
  return {
    noc_before_send: !!gates.noc_before_send,
    permit_before_submit: !!gates.permit_before_submit,
    auto_approve_all: gates.auto_approve_all !== false,
  }
}

export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: company, error } = await context.supabase
      .from('companies')
      .select('id, review_gates')
      .eq('id', context.companyId)
      .single()

    if (error || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    return Response.json({
      review_gates: normalizeReviewGates(company.review_gates || DEFAULT_REVIEW_GATES),
    })
  } catch (err) {
    console.error('Get review gates error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const reviewGates = normalizeReviewGates({
      noc_before_send: body.noc_before_send,
      permit_before_submit: body.permit_before_submit,
      auto_approve_all: body.auto_approve_all,
    })

    const { data: company, error } = await context.supabase
      .from('companies')
      .update({
        review_gates: reviewGates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', context.companyId)
      .select('id, review_gates')
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({
      review_gates: normalizeReviewGates(company.review_gates),
    })
  } catch (err) {
    console.error('Update review gates error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
