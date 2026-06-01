'use client'

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please log in again.'

export function isStaleAuthError(error) {
  if (!error) return false
  var msg = String(error.message || error.msg || error).toLowerCase()
  var code = String(error.code || error.error_code || '').toLowerCase()
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found') ||
    msg.includes('jwt expired') ||
    msg.includes('session_not_found') ||
    code.includes('session_not_found')
  )
}

function removeBrowserAuthStorage() {
  if (typeof window === 'undefined') return

  function shouldRemoveKey(key) {
    if (!key) return false
    var lower = key.toLowerCase()
    return lower.includes('supabase') || key.startsWith('sb-') || lower.includes('auth-token')
  }

  try {
    var localKeys = []
    for (var i = 0; i < localStorage.length; i++) {
      var localKey = localStorage.key(i)
      if (shouldRemoveKey(localKey)) localKeys.push(localKey)
    }
    localKeys.forEach(function(key) { localStorage.removeItem(key) })

    var sessionKeys = []
    for (var j = 0; j < sessionStorage.length; j++) {
      var sessionKey = sessionStorage.key(j)
      if (shouldRemoveKey(sessionKey)) sessionKeys.push(sessionKey)
    }
    sessionKeys.forEach(function(key) { sessionStorage.removeItem(key) })
  } catch (err) {
    console.warn('[auth] Failed to clear browser auth storage:', err)
  }
}

export async function clearStaleSupabaseSession(supabase, reason) {
  try {
    if (supabase && supabase.auth && supabase.auth.signOut) {
      await supabase.auth.signOut({ scope: 'local' })
    }
  } catch (err) {
    console.warn('[auth] signOut during stale session clear failed:', err)
  }

  removeBrowserAuthStorage()

  if (reason) {
    console.info('[auth] Cleared stale session:', reason)
  }
}
