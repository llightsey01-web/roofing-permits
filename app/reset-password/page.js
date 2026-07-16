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

export default function ResetPasswordPage() {
  useDarkPageBackground()

  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
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
  }

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    color: theme.textMuted,
  }

  useEffect(function () {
    async function prepareSession() {
      try {
        const supabase = createClient()

        // Handle PKCE / hash recovery tokens from Supabase email link
        const hash = typeof window !== 'undefined' ? window.location.hash : ''
        if (hash && hash.includes('access_token')) {
          const params = new URLSearchParams(hash.replace(/^#/, ''))
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
          }
        }

        const search = typeof window !== 'undefined' ? window.location.search : ''
        if (search.includes('code=')) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            new URLSearchParams(search).get('code')
          )
          if (exchangeError) {
            console.warn('[reset-password] code exchange failed:', exchangeError.message)
          }
        }

        const { data: { session } } = await supabase.auth.getSession()
        setSessionReady(!!session)
        if (!session) {
          setError('This reset link is invalid or has expired. Request a new link from the login page.')
        }
      } catch (err) {
        setError('Unable to verify reset link. Please try again.')
      }
      setReady(true)
    }

    prepareSession()
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
    setSuccess('')

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

    setSuccess('Password updated successfully. Redirecting...')
    setTimeout(function () {
      router.push('/contractor/dashboard')
    }, 1000)
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
          marginBottom: '28px',
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          Set New Password
        </h1>

        {!ready ? (
          <p style={{ color: theme.textMuted, textAlign: 'center', fontSize: '14px' }}>
            Verifying reset link...
          </p>
        ) : (
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
                disabled={!sessionReady || loading}
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
                disabled={!sessionReady || loading}
                style={inputStyle}
              />
            </div>

            {error && (
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
            )}

            {success && (
              <p style={{
                color: theme.success,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '10px',
                fontSize: '14px',
                marginBottom: '16px',
                padding: '10px 12px',
              }}>
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={!sessionReady || loading}
              style={{
                width: '100%',
                padding: '13px',
                backgroundColor: (!sessionReady || loading) ? theme.border : theme.accent,
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: (!sessionReady || loading) ? 'not-allowed' : 'pointer',
                boxShadow: (!sessionReady || loading) ? 'none' : '0 0 20px rgba(59, 130, 246, 0.35)',
                marginBottom: '14px',
              }}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>

            {!sessionReady ? (
              <button
                type="button"
                onClick={function () { router.push('/login') }}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: theme.accent,
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  padding: '8px 0',
                }}
              >
                ← Back to Login
              </button>
            ) : null}
          </form>
        )}

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
