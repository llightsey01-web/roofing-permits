'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetUser, redirectIfStaleSession } from '../../lib/auth/safe-auth'
import EnvironmentBadge from '../ui/EnvironmentBadge'
import { contractorTheme } from '../../lib/ui/contractor-theme'

const navItems = [
  { href: '/contractor/dashboard', label: 'My Jobs' },
  { href: '/contractor/jobs/new', label: 'New Job' },
  { href: '/contractor/ahj-guide', label: 'Permit Guide' },
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

      if (userData?.role !== 'company_admin') {
        router.push('/login')
        return
      }

      if (!userData?.company_id) {
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
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ color: contractorTheme.textMuted, fontSize: '15px' }}>Loading your portal...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: contractorTheme.pageBgGradient }}>
      <header style={{
        backgroundColor: contractorTheme.headerBg,
        borderBottom: '1px solid ' + contractorTheme.headerBorder,
        padding: '0 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: '64px',
        boxShadow: contractorTheme.shadow,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px',
              background: 'linear-gradient(135deg, #0284c7 0%, #059669 100%)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'white', fontSize: '16px', fontWeight: '700' }}>A</span>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: contractorTheme.text, fontSize: '17px', fontWeight: '700' }}>Contractor Portal</span>
                <EnvironmentBadge label="Client" variant="contractor" />
              </div>
              <span style={{ color: contractorTheme.textMuted, fontSize: '12px' }}>AHJ-iQ · permit tracking for your team</span>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: '6px' }}>
            {navItems.map(item => {
              const isActive = pathname === item.href ||
                (item.label === 'My Jobs' && pathname?.startsWith('/contractor/jobs/') && pathname !== '/contractor/jobs/new')
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  style={{
                    fontSize: '14px', padding: '8px 16px', borderRadius: '999px',
                    border: 'none', cursor: 'pointer',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>{user?.email}</span>
          <button
            onClick={handleSignOut}
            style={{
              fontSize: '13px', padding: '8px 16px',
              border: '1px solid ' + contractorTheme.borderStrong,
              borderRadius: '999px',
              backgroundColor: 'white',
              color: contractorTheme.textBody,
              cursor: 'pointer',
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
