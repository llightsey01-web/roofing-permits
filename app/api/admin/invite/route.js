import { authenticateRequest } from '../../../../lib/auth/session.js'

export async function POST(request) {
  try {
    const context = await authenticateRequest(request)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    if (!context.isSuperAdmin) {
      return Response.json({ error: 'Super admin access required' }, { status: 403 })
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
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://roofing-permits-production.up.railway.app/dashboard'

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
