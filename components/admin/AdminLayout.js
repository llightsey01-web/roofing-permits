'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import { adminTheme } from '../../lib/ui/admin-theme'

const navItems = [
  { href: '/admin', label: 'Dashboard', match: (p) => p === '/admin' },
  { href: '/admin/companies', label: 'Companies', match: (p) => p.startsWith('/admin/companies') },
  { href: '/admin/jobs', label: 'Jobs', match: (p) => p.startsWith('/admin/jobs') },
  { href: '/admin/leads', label: 'Leads', match: (p) => p.startsWith('/admin/leads') },
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
      <div style={{ minHeight: '100vh', backgroundColor: adminTheme.pageBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontSize: '13px', fontFamily: adminTheme.fontMono }}>INITIALIZING CONSOLE...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: adminTheme.pageBg, color: adminTheme.text, display: 'flex' }}>
      <aside style={{
        width: '220px',
        flexShrink: 0,
        backgroundColor: adminTheme.headerBg,
        borderRight: '1px solid ' + adminTheme.border,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
      }}>
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid ' + adminTheme.border }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{
              width: '30px', height: '30px',
              background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
              borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'white', fontSize: '12px', fontWeight: '800' }}>D</span>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: adminTheme.text }}>DART iQ</div>
              <div style={{ fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>Admin Portal</div>
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
                onClick={() => router.push(item.href)}
                style={{
                  textAlign: 'left',
                  fontSize: '13px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: adminTheme.fontMono,
                  backgroundColor: active ? adminTheme.navActive : 'transparent',
                  color: active ? adminTheme.text : adminTheme.textMuted,
                  fontWeight: active ? '600' : '400',
                  borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                }}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '14px 16px', borderTop: '1px solid ' + adminTheme.border }}>
          <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, marginBottom: '10px', wordBreak: 'break-all' }}>
            {user?.email}
          </div>
          <button
            onClick={handleSignOut}
            style={{
              width: '100%',
              fontSize: '11px',
              padding: '8px 12px',
              border: '1px solid ' + adminTheme.border,
              borderRadius: '6px',
              backgroundColor: adminTheme.surface,
              color: adminTheme.textMuted,
              cursor: 'pointer',
              fontFamily: adminTheme.fontMono,
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  )
}
