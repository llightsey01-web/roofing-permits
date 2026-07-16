import { authenticateRequest, requireCompanyUser } from '../../../../../lib/auth/session.js'

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return 'Password is required'
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number'
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter'
  }
  return ''
}

async function sendReadyForReviewEmail(companyName) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[onboarding/set-password] RESEND_API_KEY not set — skipping notification')
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

    const body = await request.json()
    const password = typeof body.password === 'string' ? body.password : ''
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : ''

    const passwordError = validatePassword(password)
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 })
    }
    if (password !== confirmPassword) {
      return Response.json({ error: 'Passwords do not match' }, { status: 400 })
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

    const existingMeta = context.user?.user_metadata || {}
    const { error: passwordUpdateError } = await context.supabase.auth.admin.updateUserById(
      context.user.id,
      {
        password,
        user_metadata: {
          ...existingMeta,
          must_change_password: false,
        },
      }
    )

    if (passwordUpdateError) {
      return Response.json({ error: 'Failed to set password: ' + passwordUpdateError.message }, { status: 500 })
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
      console.error('[onboarding/set-password] notification failed:', emailErr.message)
    }

    return Response.json({
      success: true,
      company: updated,
      notification_sent: !!notification.sent,
    })
  } catch (err) {
    console.error('[onboarding/set-password] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
