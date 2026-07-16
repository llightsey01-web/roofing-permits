import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

async function sendReadyForReviewEmail(companyName) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[onboarding/complete] RESEND_API_KEY not set — skipping notification')
    return { sent: false, skipped: true }
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: 'DART iQ <logan@dartiq.dev>',
    to: 'logan@dartiq.dev',
    subject: 'New contractor ready for review: ' + (companyName || 'Unknown company'),
    html: `
      <h2>Contractor onboarding submitted</h2>
      <p><strong>Company:</strong> ${String(companyName || 'Unknown')}</p>
      <p>Status set to <strong>pending_review</strong>. Review their company details and AHJ credentials in the admin portal.</p>
      <p><a href="https://app.dartiq.dev/admin/companies">Open Companies</a></p>
    `,
  })
  return { sent: true }
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireCompanyUser(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data: company, error: companyError } = await context.supabase
      .from('companies')
      .select('id, name, license_number, qualifier_name, qualifier_license, phone, primary_email, onboarding_status')
      .eq('id', context.companyId)
      .single()

    if (companyError || !company) {
      return Response.json({ error: 'Company not found' }, { status: 404 })
    }

    if (!company.name || !company.license_number || !company.qualifier_name || !company.qualifier_license) {
      return Response.json({ error: 'Complete company and license info before finishing onboarding' }, { status: 400 })
    }
    if (!company.phone || !company.primary_email) {
      return Response.json({ error: 'Phone and primary email are required' }, { status: 400 })
    }

    const { data: updated, error: updateError } = await context.supabase
      .from('companies')
      .update({
        onboarding_status: 'pending_review',
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', context.companyId)
      .select('*')
      .single()

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 })
    }

    let notification = { sent: false }
    try {
      notification = await sendReadyForReviewEmail(updated.name)
    } catch (emailErr) {
      console.error('[onboarding/complete] notification failed:', emailErr.message)
    }

    return Response.json({
      success: true,
      company: updated,
      notification_sent: !!notification.sent,
    })
  } catch (err) {
    console.error('[onboarding/complete] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
