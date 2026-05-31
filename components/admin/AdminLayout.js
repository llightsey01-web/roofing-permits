'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import { adminTheme } from '../../lib/ui/admin-theme'

const navItems = [
  { href: '/dashboard', label: 'Operations Queue', match: (p) => p === '/dashboard' || (p.startsWith('/jobs/') && p !== '/jobs/new') },
  { href: '/admin', label: 'Companies', match: (p) => p === '/admin' || p.startsWith('/admin/') },
  { href: '/jobs/new', label: 'Manual Intake', match: (p) => p === '/jobs/new' },
]

export default function AdminLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        router.push('/login')
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
    <div style={{ minHeight: '100vh', backgroundColor: adminTheme.pageBg, color: adminTheme.text }}>
      <header style={{
        backgroundColor: adminTheme.headerBg,
        borderBottom: '1px solid ' + adminTheme.border,
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '56px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '30px', height: '30px',
              background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
              borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px rgba(99, 102, 241, 0.4)',
            }}>
              <span style={{ color: 'white', fontSize: '13px', fontWeight: '800' }}>⚙</span>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: adminTheme.text, fontSize: '15px', fontWeight: '700', letterSpacing: '-0.02em' }}>Admin Console</span>
                <EnvironmentBadge label="Internal" variant="admin" />
              </div>
              <span style={{ color: adminTheme.textDim, fontSize: '11px', fontFamily: adminTheme.fontMono }}>AHJ-iQ · operator workspace</span>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: '2px', marginLeft: '8px' }}>
            {navItems.map(item => {
              const active = item.match(pathname || '')
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  style={{
                    fontSize: '12px', padding: '7px 12px', borderRadius: '6px',
                    border: '1px solid ' + (active ? adminTheme.border : 'transparent'),
                    cursor: 'pointer', fontFamily: adminTheme.fontMono,
                    backgroundColor: active ? adminTheme.navActive : 'transparent',
                    color: active ? adminTheme.text : adminTheme.textMuted,
                    fontWeight: active ? '600' : '400',
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>{user?.email}</span>
          <button
            onClick={handleSignOut}
            style={{
              fontSize: '11px', padding: '6px 12px',
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
      </header>
      <main>{children}</main>
    </div>
  )
}
