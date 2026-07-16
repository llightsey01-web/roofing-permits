import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const companyId = body.company_id
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const role = body.role || 'company_admin'

    if (!email || !companyId) {
      return Response.json({ error: 'email and company_id are required' }, { status: 400 })
    }

    const redirectTo = body.redirectTo ||
      (process.env.NEXT_PUBLIC_PORTAL_URL
        ? process.env.NEXT_PUBLIC_PORTAL_URL + '/login'
        : 'https://portal.dartiq.dev/login')

    const { data: inviteData, error: inviteError } = await context.supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          company_id: companyId,
          full_name: fullName,
          role,
        },
        redirectTo,
      }
    )

    if (inviteError) {
      return Response.json({ error: 'Failed to send invite: ' + inviteError.message }, { status: 500 })
    }

    return Response.json({ success: true, user: inviteData.user })
  } catch (err) {
    console.error('Admin invite error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
