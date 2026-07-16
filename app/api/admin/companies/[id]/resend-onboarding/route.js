import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'
import {
  generateTemporaryPassword,
  sendContractorWelcomeEmail,
} from '../../../../../../lib/email/contractor-welcome.js'

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
    let ownerUserId = company.owner_user_id || null

    if (company.owner_user_id) {
      const { data: owner } = await context.supabase
        .from('users')
        .select('id, email, full_name')
        .eq('id', company.owner_user_id)
        .maybeSingle()

      if (owner?.email) recipientEmail = owner.email
      if (owner?.id) ownerUserId = owner.id
      if (owner?.full_name) {
        contractorName = String(owner.full_name).trim().split(/\s+/)[0] || contractorName
      }
    }

    if (!recipientEmail) {
      return Response.json({ error: 'No owner or primary email on file for this company' }, { status: 400 })
    }
    if (!ownerUserId) {
      return Response.json({ error: 'No owner user linked to this company' }, { status: 400 })
    }

    const tempPassword = generateTemporaryPassword()
    const { error: updateError } = await context.supabase.auth.admin.updateUserById(ownerUserId, {
      password: tempPassword,
      user_metadata: {
        company_id: company.id,
        full_name: contractorName,
        role: 'company_admin',
        must_change_password: true,
      },
    })

    if (updateError) {
      return Response.json({ error: 'Failed to reset temporary password: ' + updateError.message }, { status: 500 })
    }

    const emailResult = await sendContractorWelcomeEmail({
      contractorName,
      contractorEmail: recipientEmail,
      companyName: company.name,
      tempPassword,
    })

    if (emailResult.skipped) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
    }

    return Response.json({
      success: true,
      emailed: recipientEmail,
      welcome_email_sent: true,
    })
  } catch (err) {
    console.error('[resend-onboarding] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
