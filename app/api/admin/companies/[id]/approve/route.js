import { authenticateRequest, requireSuperAdmin } from '../../../../../../lib/auth/session.js'
import { sendContractorApprovalEmail } from '../../../../../../lib/email/contractor-approval.js'
import { writeAuditLog } from '../../../../../../lib/audit/audit-log.js'

async function resolveOwnerContact(supabase, company) {
  let contractorEmail = company.primary_email || null
  let contractorName = company.qualifier_name || 'there'

  if (company.owner_user_id) {
    const { data: owner } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', company.owner_user_id)
      .maybeSingle()

    if (owner?.email) contractorEmail = owner.email
    if (owner?.full_name) {
      contractorName = String(owner.full_name).trim().split(/\s+/)[0] || contractorName
    }
  }

  return { contractorEmail, contractorName }
}

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
      .select('id, name, primary_email, qualifier_name, owner_user_id, onboarding_status')
      .eq('id', id)
      .single()

    if (companyError || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    const { data: updated, error: updateError } = await context.supabase
      .from('companies')
      .update({
        onboarding_status: 'active',
        subscription_status: 'trial',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    const { contractorEmail, contractorName } = await resolveOwnerContact(context.supabase, company)
    let emailResult = { sent: false }
    if (contractorEmail) {
      try {
        emailResult = await sendContractorApprovalEmail({
          contractorName,
          contractorEmail,
          companyName: company.name,
        })
      } catch (emailErr) {
        console.error('[approve] email failed:', emailErr.message)
      }
    }

    await writeAuditLog(context.supabase, {
      actorUserId: context.user?.id,
      actorEmail: context.userData?.email || context.user?.email,
      action: 'company.approve',
      entityType: 'company',
      entityId: id,
      companyId: id,
      metadata: {
        previous_status: company.onboarding_status,
        emailed: contractorEmail || null,
        email_sent: !!emailResult.sent,
      },
    })

    return Response.json({
      success: true,
      company: updated,
      emailed: contractorEmail,
      email_sent: !!emailResult.sent,
    })
  } catch (err) {
    console.error('[approve] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
