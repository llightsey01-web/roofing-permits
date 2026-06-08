'use client'

import { useEffect, useState, useLayoutEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../../components/ui/EnvironmentBadge'
import {
  contractorTheme,
  getPortalTheme,
  applyPortalTheme,
  togglePortalTheme,
} from '../../lib/ui/contractor-theme'
import './contractor-portal.css'

const navItems = [
  { href: '/contractor/dashboard', label: 'Dashboard', shortLabel: 'Home', icon: '⌂' },
  { href: '/contractor/jobs/new', label: 'New Application', shortLabel: 'New Job', icon: '+' },
  { href: '/contractor/settings', label: 'Settings', shortLabel: 'Settings', icon: '⚙' },
]

function isNavActive(pathname, href) {
  if (pathname === href) return true
  if (href === '/contractor/dashboard') {
    return pathname?.startsWith('/contractor/jobs/') && pathname !== '/contractor/jobs/new'
  }
  return false
}

function PortalThemeToggle() {
  const [theme, setTheme] = useState('dark')

  useLayoutEffect(function () {
    const initial = getPortalTheme()
    applyPortalTheme(initial)
    setTheme(initial)
  }, [])

  function handleToggle() {
    setTheme(togglePortalTheme())
  }

  return (
    <button
      type="button"
      className="contractor-theme-toggle"
      onClick={handleToggle}
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <svg className="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>
  )
}

export default function ContractorLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useLayoutEffect(function () {
    applyPortalTheme(getPortalTheme())
  }, [])

  useEffect(function () {
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
      <div
        className="contractor-shell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: contractorTheme.fontFamily,
        }}
      >
        <p style={{ color: contractorTheme.textMuted, fontSize: '15px' }}>Loading Dart iQ...</p>
      </div>
    )
  }

  return (
    <div
      className="contractor-shell"
      style={{ fontFamily: contractorTheme.fontFamily }}
    >
      <header
        className="contractor-header"
        style={{
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '64px',
          boxShadow: contractorTheme.shadow,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', minWidth: 0 }}>
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
              minHeight: '44px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                backgroundColor: contractorTheme.accent,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: contractorTheme.accentGlow,
                flexShrink: 0,
              }}
            >
              <span style={{ color: '#ffffff', fontSize: '15px', fontWeight: '800' }}>D</span>
            </div>
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ color: contractorTheme.text, fontSize: '18px', fontWeight: '700' }}>Dart iQ</span>
                <EnvironmentBadge label="Contractor" variant="contractor" />
              </div>
              <span
                className="contractor-header-subtitle"
                style={{ color: contractorTheme.textMuted, fontSize: '12px', display: 'block' }}
              >
                Permit automation by {contractorTheme.companyLegal}
              </span>
            </div>
          </button>
          <nav className="contractor-desktop-nav" style={{ gap: '6px', flexWrap: 'wrap' }}>
            {navItems.map(function (item) {
              const isActive = isNavActive(pathname, item.href)
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => router.push(item.href)}
                  style={{
                    fontSize: '14px',
                    padding: '10px 14px',
                    minHeight: '44px',
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
          <PortalThemeToggle />
          <span className="contractor-header-email" style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
            {user?.email}
          </span>
          <button
            type="button"
            className="contractor-desktop-signout"
            onClick={handleSignOut}
            style={{
              fontSize: '13px',
              padding: '10px 14px',
              minHeight: '44px',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '8px',
              backgroundColor: contractorTheme.inputBg,
              color: contractorTheme.textBody,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="contractor-main">{children}</main>

      <footer
        className="contractor-footer-desktop"
        style={{
          padding: '20px 24px',
          textAlign: 'center',
          fontSize: '13px',
        }}
      >
        © {contractorTheme.footerYear} {contractorTheme.companyLegal}
      </footer>

      <nav className="contractor-bottom-nav" aria-label="Mobile navigation">
        <div className="contractor-bottom-nav-inner">
          {navItems.map(function (item) {
            const isActive = isNavActive(pathname, item.href)
            return (
              <button
                key={item.href}
                type="button"
                className={'contractor-bottom-nav-item' + (isActive ? ' is-active' : '')}
                onClick={() => router.push(item.href)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="contractor-bottom-nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.shortLabel}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="contractor-bottom-nav-item"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <span className="contractor-bottom-nav-icon" aria-hidden="true">↪</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
