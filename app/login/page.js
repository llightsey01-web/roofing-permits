'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetSession } from '../../lib/auth/safe-auth'
import { SESSION_EXPIRED_MESSAGE } from '../../lib/auth/clear-stale-session'
import { contractorTheme, applyPortalTheme, getPortalTheme } from '../../lib/ui/contractor-theme'

const theme = {
  surface: 'var(--portal-surface)',
  border: 'var(--portal-border)',
  text: 'var(--portal-text)',
  textMuted: 'var(--portal-text-muted)',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  inputBg: 'var(--portal-input-bg)',
  error: 'var(--portal-error)',
  success: 'var(--portal-success)',
  fontFamily: contractorTheme.fontFamily,
}

function usePortalCanvas() {
  useEffect(function () {
    applyPortalTheme(getPortalTheme())
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

function LoginForm() {
  usePortalCanvas()

  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

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
    if (searchParams.get('session') === 'expired') {
      setNotice(SESSION_EXPIRED_MESSAGE)
    }

    async function clearStaleSessionOnLoad() {
      try {
        const supabase = createClient()
        const { staleSession } = await safeGetSession(supabase)
        if (staleSession) {
          setNotice(SESSION_EXPIRED_MESSAGE)
        }
      } catch (err) {
        console.warn('[auth] Login page stale session check failed:', err)
      }
    }

    clearStaleSessionOnLoad()
  }, [searchParams])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setNotice('')
    setSuccess('')

    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', data.user.id)
      .single()

    if (userData?.role === 'super_admin') {
      router.push('/admin')
    } else {
      router.push('/contractor/dashboard')
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        throw new Error('Request failed')
      }

      setSuccess('Check your email for a password reset link')
    } catch (err) {
      setError('Something went wrong. Please try again.')
    }

    setLoading(false)
  }

  return (
    <div
      className="dartiq-login-wrap"
      style={{
      minHeight: '100dvh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: theme.fontFamily,
      padding: '24px',
    }}>
      <style>{`
        .dartiq-login-input:focus {
          border-color: ${theme.accent} !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25) !important;
        }
        .dartiq-login-input::placeholder {
          color: #64748b;
        }
        @media (max-width: 768px) {
          .dartiq-login-wrap {
            padding: 16px !important;
            align-items: flex-start !important;
            padding-top: 48px !important;
          }
          .login-card {
            padding: 28px 20px !important;
          }
          .dartiq-login-title {
            font-size: 20px !important;
            margin-bottom: 22px !important;
          }
        }
      `}</style>

      <div
        className="login-card"
        style={{
          padding: '40px 36px',
          width: '100%',
          maxWidth: '420px',
        }}
      >
        <DartIQLogo />

        <h1
          className="dartiq-login-title"
          style={{
          color: theme.text,
          fontSize: '22px',
          fontWeight: '700',
          marginBottom: '28px',
          textAlign: 'center',
          letterSpacing: '-0.02em',
        }}>
          {mode === 'login' ? 'Welcome back' : 'Reset Your Password'}
        </h1>

        {notice && mode === 'login' && (
          <p style={{
            color: '#fbbf24',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '10px',
            fontSize: '14px',
            marginBottom: '16px',
            padding: '10px 12px',
          }}>
            {notice}
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

        {mode === 'login' ? (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle} htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className="dartiq-login-input"
                type="email"
                value={email}
                onChange={function (e) { setEmail(e.target.value) }}
                required
                autoComplete="email"
                placeholder="you@company.com"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={labelStyle} htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="dartiq-login-input"
                type="password"
                value={password}
                onChange={function (e) { setPassword(e.target.value) }}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: '20px' }}>
              <button
                type="button"
                onClick={function () {
                  setMode('forgot')
                  setError('')
                  setSuccess('')
                  setNotice('')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.accent,
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                Forgot Password?
              </button>
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
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword}>
            <p style={{
              color: theme.textMuted,
              fontSize: '14px',
              margin: '0 0 20px',
              textAlign: 'center',
              lineHeight: 1.5,
            }}>
              Enter your email address and we&apos;ll send you a link to reset your password.
            </p>

            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle} htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                className="dartiq-login-input"
                type="email"
                value={email}
                onChange={function (e) { setEmail(e.target.value) }}
                required
                autoComplete="email"
                placeholder="you@company.com"
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
                marginBottom: '14px',
              }}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={function () {
                setMode('login')
                setError('')
                setSuccess('')
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: theme.textMuted,
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '8px 0',
              }}
            >
              ← Back to Login
            </button>
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

function LoginLoading() {
  usePortalCanvas()

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: theme.fontFamily,
    }}>
      <p style={{ color: theme.textMuted, fontSize: '14px' }}>Loading...</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  )
}
