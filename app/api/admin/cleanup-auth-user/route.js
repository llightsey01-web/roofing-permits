import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

/**
 * One-time admin cleanup: delete a stuck Supabase Auth user by email.
 * POST /api/admin/cleanup-auth-user  { "email": "user@example.com" }
 */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json().catch(function () { return {} })
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) {
      return Response.json({ error: 'email is required' }, { status: 400 })
    }

    const supabase = context.supabase
    let found = null
    let page = 1
    const perPage = 200

    while (page <= 20 && !found) {
      const { data, error: listError } = await supabase.auth.admin.listUsers({
        page: page,
        perPage: perPage,
      })
      if (listError) {
        return Response.json({ error: listError.message }, { status: 500 })
      }
      const users = data?.users || []
      found = users.find(function (u) {
        return String(u.email || '').trim().toLowerCase() === email
      }) || null
      if (users.length < perPage) break
      page += 1
    }

    if (!found) {
      return Response.json({ error: 'User not found in auth' }, { status: 404 })
    }

    const { error } = await supabase.auth.admin.deleteUser(found.id)
    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    // Best-effort: also remove orphaned public.users row if present
    await supabase.from('users').delete().eq('id', found.id)

    console.log('[cleanup-auth-user] Deleted auth user:', email, found.id)
    return Response.json({
      success: true,
      message: 'Auth user deleted: ' + email,
      userId: found.id,
    })
  } catch (err) {
    console.error('[cleanup-auth-user]', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
