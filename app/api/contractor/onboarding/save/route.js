import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

function normalizeReviewGates(raw) {
  const gates = raw && typeof raw === 'object' ? raw : {}
  return {
    noc_before_send: !!gates.noc_before_send,
    permit_before_submit: !!gates.permit_before_submit,
    auto_approve_all: gates.auto_approve_all !== false,
  }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const step = Number(body.step)
    // Steps 1–3 save company data; step 4 is password via set-password
    if (![1, 2, 3].includes(step)) {
      return Response.json({ error: 'step must be 1-3' }, { status: 400 })
    }

    const { data: company, error: companyError } = await context.supabase
      .from('companies')
      .select('id, onboarding_status')
      .eq('id', context.companyId)
      .single()

    if (companyError || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    if (company.onboarding_status === 'active' || company.onboarding_status === 'complete') {
      return Response.json({ error: 'Onboarding already complete' }, { status: 400 })
    }

    const nextStep = Math.min(step + 1, 4)
    const updates = {
      updated_at: new Date().toISOString(),
      onboarding_status: company.onboarding_status === 'needs_changes' ? 'needs_changes' : 'in_progress',
      onboarding_step: nextStep,
    }

    if (step === 1) {
      if (!body.name || !String(body.name).trim()) {
        return Response.json({ error: 'Company legal name is required' }, { status: 400 })
      }
      if (!body.phone || !body.primary_email) {
        return Response.json({ error: 'Phone and primary email are required' }, { status: 400 })
      }
      updates.name = String(body.name).trim()
      updates.dba_name = body.dba_name ? String(body.dba_name).trim() : null
      updates.address = body.address ? String(body.address).trim() : null
      updates.city = body.city ? String(body.city).trim() : null
      updates.state = body.state ? String(body.state).trim() : 'FL'
      updates.zip = body.zip ? String(body.zip).trim() : null
      updates.phone = String(body.phone).trim()
      updates.primary_email = String(body.primary_email).trim()
    }

    if (step === 2) {
      if (!body.license_number || !body.qualifier_name || !body.qualifier_license) {
        return Response.json({ error: 'License number, qualifier name, and qualifier license are required' }, { status: 400 })
      }
      updates.license_number = String(body.license_number).trim()
      updates.qualifier_name = String(body.qualifier_name).trim()
      updates.qualifier_license = String(body.qualifier_license).trim()
    }

    if (step === 3) {
      updates.review_gates = normalizeReviewGates(body.review_gates || body)
    }

    const { data: updated, error: updateError } = await context.supabase
      .from('companies')
      .update(updates)
      .eq('id', context.companyId)
      .select('*')
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      step,
      next_step: nextStep,
      company: updated,
      message: 'Your progress has been saved',
    })
  } catch (err) {
    console.error('[onboarding/save] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
