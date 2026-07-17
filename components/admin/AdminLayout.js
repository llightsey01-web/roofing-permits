'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import {
  portalShellTheme,
  portalShellRootStyle,
  portalAsideStyle,
  portalNavItemStyle,
  portalSectionLabelStyle,
  portalSignOutButtonStyle,
} from '../../lib/ui/admin-theme'

const navItems = [
  { href: '/admin', label: 'Dashboard', match: (p) => p === '/admin' },
  { href: '/admin/operations', label: 'Operations', match: (p) => p.startsWith('/admin/operations') },
  { href: '/admin/companies', label: 'Companies', match: (p) => p.startsWith('/admin/companies') },
  { href: '/admin/jobs', label: 'Jobs', match: (p) => p.startsWith('/admin/jobs') },
  { href: '/admin/leads', label: 'Leads', match: (p) => p.startsWith('/admin/leads') },
  { href: '/admin/ahj-requirements', label: 'AHJ Requirements', match: (p) => p.startsWith('/admin/ahj-requirements') },
  { href: '/admin/system', label: 'System', match: (p) => p.startsWith('/admin/system') },
  { href: '/dashboard', label: 'Ops Queue', match: (p) => p === '/dashboard' || (p.startsWith('/jobs/') && !p.startsWith('/admin/')) },
]

export default function AdminLayout({ children }) {
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
          .select('role')
          .eq('id', authUser.id)
          .single()

        if (userData?.role !== 'super_admin') {
          router.push('/contractor/dashboard')
          return
        }

        setUser(authUser)
        setLoading(false)
      } catch (err) {
        console.error('[auth] Admin layout auth check failed:', err)
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
        backgroundColor: portalShellTheme.pageBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <p style={{
          color: portalShellTheme.textMuted,
          fontSize: '13px',
          fontFamily: portalShellTheme.fontMono,
        }}>
          INITIALIZING CONSOLE...
        </p>
      </div>
    )
  }

  return (
    <div style={portalShellRootStyle()}>
      <aside style={portalAsideStyle()}>
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid ' + portalShellTheme.border }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '30px',
              height: '30px',
              background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ color: 'white', fontSize: '12px', fontWeight: '800' }}>D</span>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: portalShellTheme.text }}>DART iQ</div>
              <div style={{ fontSize: '10px', color: portalShellTheme.textDim, fontFamily: portalShellTheme.fontMono }}>
                Admin Portal
              </div>
            </div>
          </div>
          <EnvironmentBadge label="Internal" variant="admin" />
        </div>

        <nav style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
          {navItems.map(item => {
            const active = item.match(pathname || '')
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                style={portalNavItemStyle(active)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '14px 16px', borderTop: '1px solid ' + portalShellTheme.border }}>
          <div style={{
            fontSize: '11px',
            color: portalShellTheme.textDim,
            fontFamily: portalShellTheme.fontMono,
            marginBottom: '10px',
            wordBreak: 'break-all',
          }}>
            {user?.email}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            style={portalSignOutButtonStyle()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  )
}
