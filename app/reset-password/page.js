'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { contractorTheme } from '../../lib/ui/contractor-theme'

const theme = {
  pageBg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#ffffff',
  textMuted: '#94a3b8',
  accent: '#3b82f6',
  inputBg: '#0f172a',
  error: '#ef4444',
  success: '#10b981',
  warning: '#f59e0b',
  fontFamily: contractorTheme.fontFamily,
}

function useDarkPageBackground() {
  useEffect(function () {
    const html = document.documentElement
    const body = document.body
    const prevHtmlBg = html.style.backgroundColor
    const prevBodyBg = body.style.backgroundColor
    const prevBodyColor = body.style.color

    html.style.backgroundColor = theme.pageBg
    body.style.backgroundColor = theme.pageBg
    body.style.color = theme.text

    return function () {
      html.style.backgroundColor = prevHtmlBg
      body.style.backgroundColor = prevBodyBg
      body.style.color = prevBodyColor
    }
  }, [])
}

function DartIQLogo() {
  return (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: '42px',
          height: '42px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          borderRadius: '11px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.35)',
        }}>
          <span style={{ color: '#ffffff', fontSize: '19px', fontWeight: '800' }}>D</span>
        </div>
        <span style={{
          color: theme.text,
          fontSize: '26px',
          fontWeight: '800',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          DART iQ
        </span>
      </div>
    </div>
  )
}

async function establishRecoverySession(supabase) {
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  const search = typeof window !== 'undefined' ? window.location.search : ''

  // Implicit / hash flow: #access_token=...&refresh_token=...&type=recovery
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error) throw error
      // Clean tokens out of the address bar after session is established
      window.history.replaceState({}, document.title, '/reset-password')
      return true
    }
  }

  // PKCE flow: ?code=...
  if (search.includes('code=')) {
    const code = new URLSearchParams(search).get('code')
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) throw error
      window.history.replaceState({}, document.title, '/reset-password')
      return true
    }
  }

  const { data: { session } } = await supabase.auth.getSession()
  return Boolean(session)
}

export default function ResetPasswordPage() {
  useDarkPageBackground()

  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid ' + theme.border,
    borderRadius: '10px',
    fontSize: '15px',
    boxSizing: 'border-box',
    backgroundColor: theme.inputBg,
    color: theme.text,
    outline: 'none',
    marginTop: '6px',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: theme.textMuted,
  }

  useEffect(function () {
    const supabase = createClient()
    let cancelled = false

    const { data: authListener } = supabase.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        if (!cancelled) {
          setSessionReady(true)
          setVerifying(false)
          setError('')
        }
      }
    })

    async function prepareSession() {
      try {
        const ok = await establishRecoverySession(supabase)
        if (cancelled) return
        if (ok) {
          setSessionReady(true)
          setError('')
        } else {
          setSessionReady(false)
          setError('This reset link is invalid or has expired. Request a new link from the login page.')
        }
      } catch (err) {
        if (!cancelled) {
          setSessionReady(false)
          setError(err.message || 'Unable to verify reset link. Please try again.')
        }
      }
      if (!cancelled) setVerifying(false)
    }

    prepareSession()

    return function () {
      cancelled = true
      authListener.subscription.unsubscribe()
    }
  }, [])

  function validatePassword(value) {
    if (value.length < 8) return 'Password must be at least 8 characters'
    if (!/[0-9]/.test(value)) return 'Password must include at least one number'
    if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(function () {
      router.push('/contractor/dashboard')
    }, 2000)
  }

  if (success) {
    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.pageBg,
        fontFamily: theme.fontFamily,
        padding: '24px',
      }}>
        <div style={{
          backgroundColor: theme.surface,
          padding: '40px 36px',
          borderRadius: '14px',
          border: '1px solid ' + theme.border,
          textAlign: 'center',
          maxWidth: '420px',
          width: '100%',
        }}>
          <h2 style={{ color: theme.success, margin: '0 0 10px', fontSize: '22px' }}>✓ Password Updated</h2>
          <p style={{ color: theme.textMuted, margin: 0 }}>Redirecting to your portal...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.pageBg,
      fontFamily: theme.fontFamily,
      padding: '24px',
    }}>
      <style>{`
        .dartiq-login-input:focus {
          border-color: ${theme.accent} !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25) !important;
        }
      `}</style>

      <div style={{
        backgroundColor: theme.surface,
        padding: '40px 36px',
        borderRadius: '14px',
        border: '1px solid ' + theme.border,
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
      }}>
        <DartIQLogo />

        <h1 style={{
          color: theme.text,
          fontSize: '22px',
          fontWeight: '700',
          marginBottom: '8px',
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          Set New Password
        </h1>
        <p style={{
          color: theme.textMuted,
          textAlign: 'center',
          fontSize: '14px',
          marginTop: 0,
          marginBottom: '28px',
        }}>
          Choose a new password for your DART iQ account
        </p>

        {verifying ? (
          <p style={{ color: theme.warning, textAlign: 'center', fontSize: '14px' }}>
            Verifying reset link...
          </p>
        ) : null}

        {!verifying && sessionReady ? (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle} htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                className="dartiq-login-input"
                type="password"
                value={password}
                onChange={function (e) { setPassword(e.target.value) }}
                required
                autoComplete="new-password"
                disabled={loading}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle} htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                className="dartiq-login-input"
                type="password"
                value={confirmPassword}
                onChange={function (e) { setConfirmPassword(e.target.value) }}
                required
                autoComplete="new-password"
                disabled={loading}
                style={inputStyle}
              />
            </div>

            {error ? (
              <p style={{
                color: theme.error,
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '10px',
                fontSize: '14px',
                marginBottom: '16px',
                padding: '10px 12px',
              }}>
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px',
                backgroundColor: loading ? theme.border : theme.accent,
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 0 20px rgba(59, 130, 246, 0.35)',
              }}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : null}

        {!verifying && !sessionReady ? (
          <div>
            {error ? (
              <p style={{
                color: theme.error,
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '10px',
                fontSize: '14px',
                marginBottom: '16px',
                padding: '10px 12px',
              }}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={function () { router.push('/login') }}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: 'transparent',
                border: '1px solid ' + theme.border,
                borderRadius: '10px',
                color: theme.accent,
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              ← Back to Login
            </button>
          </div>
        ) : null}

        <p style={{
          textAlign: 'center',
          fontSize: '12px',
          color: theme.textMuted,
          marginTop: '28px',
          marginBottom: 0,
        }}>
          © {contractorTheme.footerYear} {contractorTheme.companyLegal}
        </p>
      </div>
    </div>
  )
}
