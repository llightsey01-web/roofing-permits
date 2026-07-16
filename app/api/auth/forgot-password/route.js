import { createClient } from '../../../../lib/supabase-server.js'

const PRODUCTION_PORTAL_URL = 'https://portal.dartiq.dev'

function getPortalBaseUrl() {
  const raw = String(process.env.NEXT_PUBLIC_PORTAL_URL || PRODUCTION_PORTAL_URL).replace(/\/$/, '')
  // Never send password-reset links to localhost (common misconfigured Railway/env value)
  if (/localhost|127\.0\.0\.1/i.test(raw)) {
    return PRODUCTION_PORTAL_URL
  }
  return raw || PRODUCTION_PORTAL_URL
}

export async function POST(request) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!email) {
      return Response.json({ success: true })
    }

    const supabase = createClient()
    const redirectTo = getPortalBaseUrl() + '/reset-password'

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })

    if (error) {
      console.error('[auth/forgot-password] Error:', error.message, 'redirectTo:', redirectTo)
    } else {
      console.log('[auth/forgot-password] Reset email requested, redirectTo:', redirectTo)
    }

    // Always return success — don't reveal if email exists
    return Response.json({ success: true })
  } catch (err) {
    console.error('[auth/forgot-password] Error:', err.message)
    return Response.json({ success: true })
  }
}
