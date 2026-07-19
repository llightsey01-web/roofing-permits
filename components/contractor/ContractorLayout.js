'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import {
  portalShellTheme,
  portalShellRootClassName,
  portalShellRootStyle,
  portalAsideStyle,
  portalNavItemStyle,
  portalSectionLabelStyle,
  portalSignOutButtonStyle,
} from '../../lib/ui/admin-theme'

const navSections = [
  {
    label: 'MAIN',
    items: [
      {
        href: '/contractor/dashboard',
        label: 'Dashboard',
        icon: '📋',
        match: (p) => p === '/contractor/dashboard',
      },
      {
        href: '/contractor/jobs/new',
        label: 'New Job',
        icon: '📝',
        match: (p) => p === '/contractor/jobs/new',
      },
      {
        href: '/contractor/jobs',
        label: 'Jobs',
        icon: '📁',
        match: (p) =>
          p === '/contractor/jobs' ||
          (p.startsWith('/contractor/jobs/') && p !== '/contractor/jobs/new'),
      },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      {
        href: '/contractor/ahj-guide',
        label: 'Permit Guide',
        icon: '📖',
        match: (p) => p.startsWith('/contractor/ahj-guide'),
      },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      {
        href: '/contractor/settings',
        label: 'Settings',
        icon: '⚙️',
        match: (p) => p.startsWith('/contractor/settings'),
      },
    ],
  },
]

export default function ContractorLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [company, setCompany] = useState(null)
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

        const { data: companyData } = await supabase
          .from('companies')
          .select('id, name, onboarding_status, notes')
          .eq('id', userData.company_id)
          .single()

        const status = companyData?.onboarding_status || 'pending'
        const onOnboarding = pathname?.startsWith('/contractor/onboarding')

        if ((status === 'pending' || status === 'in_progress' || status === 'needs_changes') && !onOnboarding) {
          router.replace('/contractor/onboarding')
          return
        }

        setCompany(companyData || null)
        setUser({ ...authUser, ...userData })
        setLoading(false)

        if (companyData?.name) {
          document.title = companyData.name + ' — DART iQ'
        } else {
          document.title = 'DART iQ Contractor Portal'
        }
      } catch (err) {
        console.error('[auth] Contractor layout auth check failed:', err)
        router.replace('/login')
      }
    }
    checkAuth()
  }, [router, pathname])

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
          LOADING PORTAL...
        </p>
      </div>
    )
  }

  const status = company?.onboarding_status || 'pending'
  const showHolding = status === 'pending_review'
  const hideNav =
    status === 'pending' ||
    status === 'in_progress' ||
    status === 'needs_changes' ||
    status === 'pending_review'

  return (
    <div className={portalShellRootClassName} style={portalShellRootStyle()}>
      {!hideNav ? (
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
                  Contractor Portal
                </div>
              </div>
            </div>
            <EnvironmentBadge label="Contractor" variant="contractor" />
            {company?.name ? (
              <div style={{
                marginTop: '10px',
                fontSize: '11px',
                color: portalShellTheme.textMuted,
                fontFamily: portalShellTheme.fontMono,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {company.name}
              </div>
            ) : null}
          </div>

          <nav style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {navSections.map(function (section) {
              return (
                <div key={section.label}>
                  <p style={portalSectionLabelStyle()}>{section.label}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {section.items.map(function (item) {
                      const active = item.match(pathname || '')
                      return (
                        <button
                          key={item.href}
                          type="button"
                          onClick={() => router.push(item.href)}
                          style={portalNavItemStyle(active)}
                        >
                          <span aria-hidden="true" style={{ fontSize: '13px', lineHeight: 1, width: '18px', textAlign: 'center' }}>
                            {item.icon}
                          </span>
                          <span>{item.label}</span>
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
              🚪 Logout
            </button>
          </div>
        </aside>
      ) : null}

      <main style={{ flex: 1, minWidth: 0 }}>
        {showHolding && !pathname?.startsWith('/contractor/onboarding') ? (
          <div style={{ maxWidth: '640px', margin: '48px auto', padding: '0 20px' }}>
            <div style={{
              backgroundColor: portalShellTheme.surface,
              border: '1px solid ' + portalShellTheme.border,
              borderRadius: '8px',
              padding: '36px',
              textAlign: 'center',
            }}>
              <h1 style={{ margin: '0 0 12px', color: portalShellTheme.text, fontSize: '22px' }}>
                Account under review
              </h1>
              <p style={{ margin: 0, color: portalShellTheme.textMuted, lineHeight: 1.6, fontSize: '14px' }}>
                Account under review. We will notify you within 1 business day.
              </p>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
