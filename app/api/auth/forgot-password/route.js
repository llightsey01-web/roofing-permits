import { createClient } from '../../../../lib/supabase-server.js'

export async function POST(request) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!email) {
      return Response.json({ success: true })
    }

    const supabase = createClient()
    const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.dartiq.dev'

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: portalUrl.replace(/\/$/, '') + '/reset-password',
    })

    if (error) {
      console.error('[auth/forgot-password] Error:', error.message)
    }

    // Always return success — don't reveal if email exists
    return Response.json({ success: true })
  } catch (err) {
    console.error('[auth/forgot-password] Error:', err.message)
    return Response.json({ success: true })
  }
}
