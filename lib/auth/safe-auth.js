'use client'

import {
  clearStaleSupabaseSession,
  isStaleAuthError,
  SESSION_EXPIRED_MESSAGE,
} from './clear-stale-session'

export { SESSION_EXPIRED_MESSAGE }

export function getSessionExpiredLoginPath() {
  return '/login?session=expired'
}

export function redirectIfStaleSession(router, staleSession) {
  if (!staleSession) return false
  router.replace(getSessionExpiredLoginPath())
  return true
}

export async function safeGetSession(supabase) {
  try {
    var result = await supabase.auth.getSession()
    var error = result.error
    var session = result.data && result.data.session ? result.data.session : null

    if (error && isStaleAuthError(error)) {
      await clearStaleSupabaseSession(supabase, error.message)
      return { session: null, error: error, staleSession: true }
    }

    if (error) {
      return { session: null, error: error, staleSession: false }
    }

    return { session: session, error: null, staleSession: false }
  } catch (err) {
    if (isStaleAuthError(err)) {
      await clearStaleSupabaseSession(supabase, err.message)
      return { session: null, error: err, staleSession: true }
    }
    return { session: null, error: err, staleSession: false }
  }
}

export async function safeGetUser(supabase) {
  try {
    var result = await supabase.auth.getUser()
    var error = result.error
    var user = result.data && result.data.user ? result.data.user : null

    if (error && isStaleAuthError(error)) {
      await clearStaleSupabaseSession(supabase, error.message)
      return { user: null, error: error, staleSession: true }
    }

    if (error) {
      return { user: null, error: error, staleSession: false }
    }

    return { user: user, error: null, staleSession: false }
  } catch (err) {
    if (isStaleAuthError(err)) {
      await clearStaleSupabaseSession(supabase, err.message)
      return { user: null, error: err, staleSession: true }
    }
    return { user: null, error: err, staleSession: false }
  }
}
