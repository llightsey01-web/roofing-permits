'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../../components/ui/EnvironmentBadge'
import { contractorTheme } from '../../lib/ui/contractor-theme'

const navItems = [
  { href: '/contractor/dashboard', label: 'Dashboard' },
  { href: '/contractor/jobs/new', label: 'New Application' },
  { href: '/contractor/settings', label: 'Settings' },
]

export default function ContractorLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      try {
        const supabase = createClient()
        const { user: authUser, staleSession } = await safeGetUser(supabase)
        if (redirectIfStaleSession(router, staleSession)) return
        if (!authUser) {
          router.replace('/login')
          return
        }

        const { data: userData } = await supabase
          .from('users')
          .select('role, company_id, full_name')
          .eq('id', authUser.id)
          .single()

        if (userData?.role === 'super_admin') {
          router.push('/dashboard')
          return
        }

        if (userData?.role !== 'company_admin' || !userData?.company_id) {
          router.push('/login')
          return
        }

        setUser({ ...authUser, ...userData })
        setLoading(false)
      } catch (err) {
        console.error('[auth] Contractor layout auth check failed:', err)
        router.replace('/login')
      }
    }
    checkAuth()
  }, [router])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: contractorTheme.pageBgGradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: contractorTheme.fontFamily,
      }}>
        <p style={{ color: contractorTheme.textMuted, fontSize: '15px' }}>Loading Dart iQ...</p>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: contractorTheme.pageBgGradient,
      fontFamily: contractorTheme.fontFamily,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        backgroundColor: contractorTheme.headerBg,
        borderBottom: '1px solid ' + contractorTheme.headerBorder,
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '64px',
        boxShadow: contractorTheme.shadow,
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => router.push('/contractor/dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <div style={{
              width: '36px',
              height: '36px',
              backgroundColor: contractorTheme.accent,
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ color: '#ffffff', fontSize: '15px', fontWeight: '800' }}>D</span>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: contractorTheme.text, fontSize: '18px', fontWeight: '700' }}>Dart iQ</span>
                <EnvironmentBadge label="Contractor" variant="contractor" />
              </div>
              <span style={{ color: contractorTheme.textMuted, fontSize: '12px' }}>
                Permit automation by {contractorTheme.companyLegal}
              </span>
            </div>
          </button>
          <nav style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {navItems.map(item => {
              const isActive = pathname === item.href ||
                (item.href === '/contractor/dashboard' && pathname?.startsWith('/contractor/jobs/') && pathname !== '/contractor/jobs/new')
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => router.push(item.href)}
                  style={{
                    fontSize: '14px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: isActive ? contractorTheme.navActiveBg : 'transparent',
                    color: isActive ? contractorTheme.navActive : contractorTheme.textMuted,
                    fontWeight: isActive ? '600' : '500',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>{user?.email}</span>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              fontSize: '13px',
              padding: '8px 14px',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              color: contractorTheme.textBody,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={{
        borderTop: '1px solid ' + contractorTheme.border,
        padding: '20px 24px',
        textAlign: 'center',
        fontSize: '13px',
        color: contractorTheme.textMuted,
        backgroundColor: '#ffffff',
      }}>
        © {contractorTheme.footerYear} {contractorTheme.companyLegal}
      </footer>
    </div>
  )
}
