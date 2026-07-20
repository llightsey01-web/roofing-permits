'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import PortalThemeToggle from '../ui/PortalThemeToggle'
import {
  portalShellTheme,
  portalShellRootClassName,
  portalShellRootStyle,
  portalAsideStyle,
  portalNavItemStyle,
  portalSectionLabelStyle,
  portalSectionHeaderStyle,
  portalSectionRuleStyle,
  portalSignOutButtonStyle,
} from '../../lib/ui/admin-theme'
import { applyPortalTheme, getPortalTheme } from '../../lib/ui/contractor-theme'

const navSections = [
  {
    label: 'MAIN',
    items: [
      { href: '/admin', label: 'Dashboard', match: (p) => p === '/admin' },
      { href: '/admin/operations', label: 'Operations', match: (p) => p.startsWith('/admin/operations') },
      { href: '/admin/workflows', label: 'Workflows', match: (p) => p.startsWith('/admin/workflows') },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { href: '/admin/companies', label: 'Companies', match: (p) => p.startsWith('/admin/companies') },
      { href: '/admin/jobs', label: 'Jobs', match: (p) => p.startsWith('/admin/jobs') },
      { href: '/admin/leads', label: 'Leads', match: (p) => p.startsWith('/admin/leads') },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { href: '/admin/ahj-requirements', label: 'AHJ Requirements', match: (p) => p.startsWith('/admin/ahj-requirements') },
      { href: '/admin/system', label: 'System', match: (p) => p.startsWith('/admin/system') },
      { href: '/dashboard', label: 'Ops Queue', match: (p) => p === '/dashboard' || (p.startsWith('/jobs/') && !p.startsWith('/admin/')) },
    ],
  },
]

export default function AdminLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    applyPortalTheme(getPortalTheme())
  }, [])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

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
      <div
        className={portalShellRootClassName}
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: portalShellTheme.text,
        }}
      >
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
    <div className={portalShellRootClassName + ' has-mobile-nav'} style={portalShellRootStyle()}>
      <div className="mobile-header">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onClick={function () { setMobileMenuOpen(!mobileMenuOpen) }}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="mobile-header-brand">DART iQ</span>
      </div>

      {mobileMenuOpen ? (
        <div
          className="mobile-overlay"
          onClick={function () { setMobileMenuOpen(false) }}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={'portal-sidebar' + (mobileMenuOpen ? ' mobile-open' : '')}
        style={portalAsideStyle()}
      >
        <button
          type="button"
          className="mobile-sidebar-close"
          aria-label="Close menu"
          onClick={function () { setMobileMenuOpen(false) }}
        >
          ×
        </button>

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

        <nav style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', flex: 1 }}>
          {navSections.map(function (section) {
            return (
              <div key={section.label}>
                <div style={portalSectionHeaderStyle()} aria-hidden="true">
                  <span style={portalSectionLabelStyle()}>{section.label}</span>
                  <div style={portalSectionRuleStyle()} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {section.items.map(function (item) {
                    const active = item.match(pathname || '')
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={function () {
                          setMobileMenuOpen(false)
                          router.push(item.href)
                        }}
                        style={portalNavItemStyle(active)}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
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

      <main className="portal-main" style={{ flex: 1, minWidth: 0 }}>
        <div className="portal-main-header">
          <PortalThemeToggle />
        </div>
        {children}
      </main>
    </div>
  )
}
