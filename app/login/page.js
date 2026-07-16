'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetSession } from '../../lib/auth/safe-auth'
import { SESSION_EXPIRED_MESSAGE } from '../../lib/auth/clear-stale-session'
import { contractorTheme } from '../../lib/ui/contractor-theme'

const theme = {
  pageBg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#ffffff',
  textMuted: '#94a3b8',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  inputBg: '#0f172a',
  error: '#ef4444',
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

function LoginForm() {
  useDarkPageBackground()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
        .dartiq-login-input::placeholder {
          color: #64748b;
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
          Welcome back
        </h1>

        {notice && (
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

          <div style={{ marginBottom: '24px' }}>
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
  useDarkPageBackground()

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.pageBg,
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
