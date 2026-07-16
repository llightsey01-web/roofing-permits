import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'
import { sendContractorWelcomeEmail, PORTAL_LOGIN_URL } from '../../../../../../lib/email/contractor-welcome.js'

export async function POST(request, { params }) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { id } = await params
    const { data: company, error: companyError } = await context.supabase
      .from('companies')
      .select('id, name, primary_email, owner_user_id, qualifier_name')
      .eq('id', id)
      .single()

    if (companyError || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    let recipientEmail = company.primary_email || null
    let contractorName = company.qualifier_name || 'there'

    if (company.owner_user_id) {
      const { data: owner } = await context.supabase
        .from('users')
        .select('email, full_name')
        .eq('id', company.owner_user_id)
        .maybeSingle()

      if (owner?.email) recipientEmail = owner.email
      if (owner?.full_name) {
        contractorName = String(owner.full_name).trim().split(/\s+/)[0] || contractorName
      }
    }

    if (!recipientEmail) {
      return Response.json({ error: 'No owner or primary email on file for this company' }, { status: 400 })
    }

    // Re-invite via Supabase so they can set/reset their password if needed
    const { error: inviteError } = await context.supabase.auth.admin.inviteUserByEmail(
      recipientEmail,
      {
        data: {
          company_id: company.id,
          full_name: contractorName,
          role: 'company_admin',
        },
        redirectTo: PORTAL_LOGIN_URL + '/login',
      }
    )

    // inviteUserByEmail fails if user already exists — still send welcome email
    if (inviteError && !/already.*(registered|exists|been)/i.test(inviteError.message)) {
      console.warn('[resend-onboarding] invite warning:', inviteError.message)
    }

    const emailResult = await sendContractorWelcomeEmail({
      contractorName,
      contractorEmail: recipientEmail,
      companyName: company.name,
    })

    if (emailResult.skipped) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
    }

    return Response.json({
      success: true,
      emailed: recipientEmail,
      welcome_email_sent: true,
      invite_warning: inviteError ? inviteError.message : null,
    })
  } catch (err) {
    console.error('[resend-onboarding] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
