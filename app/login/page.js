'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetSession } from '../../lib/auth/safe-auth'
import { SESSION_EXPIRED_MESSAGE } from '../../lib/auth/clear-stale-session'
import { contractorTheme } from '../../lib/ui/contractor-theme'

const loginTheme = {
  pageBg: '#0f172a',
  pageBgGradient: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)',
  surface: '#1e293b',
  border: '#334155',
  text: '#ffffff',
  textMuted: '#94a3b8',
  accent: '#3b82f6',
  accentGlow: '0 0 20px rgba(59, 130, 246, 0.45)',
  accentSoft: 'rgba(59, 130, 246, 0.12)',
  warningSoft: 'rgba(217, 119, 6, 0.15)',
  errorSoft: 'rgba(239, 68, 68, 0.15)',
  inputBg: '#1e293b',
  shadowCard: '0 4px 24px rgba(0, 0, 0, 0.35)',
  fontFamily: contractorTheme.fontFamily,
}

function DartIQLogo() {
  return (
    <div style={{ textAlign: 'center', marginBottom: '28px' }}>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '8px',
      }}>
        <div style={{
          width: '44px',
          height: '44px',
          background: `linear-gradient(135deg, ${loginTheme.accent} 0%, #2563eb 100%)`,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: loginTheme.accentGlow,
        }}>
          <span style={{ color: '#ffffff', fontSize: '20px', fontWeight: '800' }}>D</span>
        </div>
        <span style={{
          color: loginTheme.text,
          fontSize: '28px',
          fontWeight: '700',
          letterSpacing: '-0.02em',
        }}>
          Dart iQ
        </span>
      </div>
      <p style={{
        color: loginTheme.textMuted,
        fontSize: '13px',
        margin: 0,
      }}>
        Permit automation by {contractorTheme.companyLegal}
      </p>
    </div>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    border: '1px solid ' + loginTheme.border,
    borderRadius: '10px',
    fontSize: '14px',
    boxSizing: 'border-box',
    backgroundColor: loginTheme.inputBg,
    color: loginTheme.text,
    outline: 'none',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    color: loginTheme.textMuted,
  }

  useEffect(() => {
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
    } else {
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (userData?.role === 'super_admin') {
        router.push('/dashboard')
      } else {
        router.push('/contractor/dashboard')
      }
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: loginTheme.pageBgGradient,
      fontFamily: loginTheme.fontFamily,
      padding: '24px',
    }}>
      <style>{`
        .dartiq-login-input:focus {
          border-color: ${loginTheme.accent} !important;
          box-shadow: ${loginTheme.accentGlow} !important;
        }
      `}</style>

      <div style={{
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        padding: '40px 36px',
        borderRadius: '12px',
        border: '1px solid ' + loginTheme.border,
        width: '100%',
        maxWidth: '420px',
        boxShadow: loginTheme.shadowCard,
        backdropFilter: 'blur(8px)',
      }}>
        <DartIQLogo />

        <p style={{
          color: loginTheme.textMuted,
          fontSize: '15px',
          marginBottom: '28px',
          textAlign: 'center',
        }}>
          Sign in to your account
        </p>

        {notice && (
          <p style={{
            color: '#fbbf24',
            backgroundColor: loginTheme.warningSoft,
            border: '1px solid rgba(217, 119, 6, 0.35)',
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
            <label style={labelStyle}>Email</label>
            <input
              className="dartiq-login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Password</label>
            <input
              className="dartiq-login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </div>

          {error && (
            <p style={{
              color: '#f87171',
              backgroundColor: loginTheme.errorSoft,
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
              padding: '12px',
              backgroundColor: loading ? loginTheme.border : loginTheme.accent,
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : loginTheme.accentGlow,
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p style={{
          textAlign: 'center',
          fontSize: '12px',
          color: loginTheme.textMuted,
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
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: loginTheme.pageBgGradient,
      fontFamily: loginTheme.fontFamily,
    }}>
      <p style={{ color: loginTheme.textMuted, fontSize: '14px' }}>Loading...</p>
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
