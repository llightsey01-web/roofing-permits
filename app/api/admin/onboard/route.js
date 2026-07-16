import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'
import { sendContractorWelcomeEmail, PORTAL_LOGIN_URL } from '../../../../lib/email/contractor-welcome.js'

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
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const company = body.company || {}
    const owner = body.owner || {}
    const ahjs = Array.isArray(body.ahjs) ? body.ahjs : []

    const name = typeof company.name === 'string' ? company.name.trim() : ''
    const ownerEmail = typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : ''
    const firstName = typeof owner.first_name === 'string' ? owner.first_name.trim() : ''
    const lastName = typeof owner.last_name === 'string' ? owner.last_name.trim() : ''
    const fullName = (firstName + ' ' + lastName).trim()

    if (!name || !ownerEmail || !firstName || !lastName) {
      return Response.json({ error: 'Company name and owner first/last/email are required' }, { status: 400 })
    }
    if (!company.license_number || !company.qualifier_name || !company.qualifier_license) {
      return Response.json({ error: 'License number, qualifier name, and qualifier license are required' }, { status: 400 })
    }
    if (!company.primary_email || !company.phone) {
      return Response.json({ error: 'Primary email and phone are required' }, { status: 400 })
    }

    const trialDays = Number(company.trial_days) || 30
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
    const reviewGates = normalizeReviewGates(company.review_gates)

    const { data: createdCompany, error: companyError } = await context.supabase
      .from('companies')
      .insert({
        name,
        dba_name: company.dba_name || null,
        license_number: company.license_number,
        qualifier_name: company.qualifier_name,
        qualifier_license: company.qualifier_license,
        primary_email: company.primary_email,
        phone: company.phone,
        address: company.address || null,
        city: company.city || null,
        state: company.state || 'FL',
        zip: company.zip || null,
        is_active: true,
        onboarding_status: 'complete',
        onboarding_completed_at: new Date().toISOString(),
        subscription_plan: company.subscription_plan || 'starter',
        subscription_status: 'trial',
        trial_ends_at: trialEndsAt,
        notes: company.notes || null,
        review_gates: reviewGates,
      })
      .select('*')
      .single()

    if (companyError || !createdCompany) {
      return Response.json({ error: 'Failed to create company: ' + (companyError?.message || 'unknown') }, { status: 500 })
    }

    const redirectTo = PORTAL_LOGIN_URL + '/login'
    const { data: inviteData, error: inviteError } = await context.supabase.auth.admin.inviteUserByEmail(
      ownerEmail,
      {
        data: {
          company_id: createdCompany.id,
          full_name: fullName,
          role: 'company_admin',
        },
        redirectTo,
      }
    )

    if (inviteError || !inviteData?.user) {
      await context.supabase.from('companies').delete().eq('id', createdCompany.id)
      return Response.json({ error: 'Failed to invite user: ' + (inviteError?.message || 'unknown') }, { status: 500 })
    }

    const { error: userError } = await context.supabase.from('users').upsert({
      id: inviteData.user.id,
      company_id: createdCompany.id,
      role: 'company_admin',
      email: ownerEmail,
      full_name: fullName,
    }, { onConflict: 'id' })

    if (userError) {
      return Response.json({ error: 'Company created but user profile failed: ' + userError.message }, { status: 500 })
    }

    await context.supabase
      .from('companies')
      .update({ owner_user_id: inviteData.user.id })
      .eq('id', createdCompany.id)

    const { data: portals } = await context.supabase
      .from('ahj_portals')
      .select('id, name, county_or_city')

    const credentialRows = []
    for (const ahj of ahjs) {
      const label = String(ahj.label || ahj.id || '').toLowerCase()
      const portal = (portals || []).find(p => {
        const hay = ((p.name || '') + ' ' + (p.county_or_city || '')).toLowerCase()
        return hay.includes(label.split(' ')[0])
      })

      credentialRows.push({
        company_id: createdCompany.id,
        provider: ahj.provider || (label.includes('lee') ? 'lee_accela' : 'polk_accela'),
        ahj_id: portal?.id || null,
        credential_type: 'ahj_portal',
        is_active: true,
      })
    }

    if (credentialRows.length > 0) {
      const { error: credError } = await context.supabase
        .from('company_credentials')
        .upsert(credentialRows, { onConflict: 'company_id,provider,ahj_id', ignoreDuplicates: true })
      if (credError) {
        console.warn('[admin/onboard] credential placeholders failed:', credError.message)
      }
    }

    let emailResult = { sent: false }
    try {
      emailResult = await sendContractorWelcomeEmail({
        contractorName: firstName,
        contractorEmail: ownerEmail,
        companyName: name,
      })
    } catch (emailErr) {
      console.error('[admin/onboard] welcome email failed:', emailErr.message)
    }

    return Response.json({
      success: true,
      company_id: createdCompany.id,
      user_id: inviteData.user.id,
      login_url: PORTAL_LOGIN_URL,
      welcome_email_sent: !!emailResult.sent,
    })
  } catch (err) {
    console.error('[admin/onboard] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
