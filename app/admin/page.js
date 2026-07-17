'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { adminTheme, adminStatCardStyle, adminPanelStyle } from '../../lib/ui/admin-theme'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    companies: 0,
    jobs: 0,
    activeRuns: 0,
    jobsToday: 0,
    nocGenerated: 0,
    permitsSubmitted: 0,
    leads: 0,
  })
  const [recentLeads, setRecentLeads] = useState([])
  const [health, setHealth] = useState(null)
  const [automationEnabled, setAutomationEnabled] = useState(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayIso = todayStart.toISOString()

      const [
        companiesRes,
        jobsRes,
        activeRes,
        todayRes,
        nocRes,
        permitRes,
        leadsCountRes,
        leadsRes,
      ] = await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('jobs').select('id', { count: 'exact', head: true }),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('job_status', 'automation_running'),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).not('noc_status', 'eq', 'not_started').not('noc_status', 'is', null),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).in('job_status', ['submitted', 'permit_issued']),
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(8),
      ])

      setStats({
        companies: companiesRes.count || 0,
        jobs: jobsRes.count || 0,
        activeRuns: activeRes.count || 0,
        jobsToday: todayRes.count || 0,
        nocGenerated: nocRes.count || 0,
        permitsSubmitted: permitRes.count || 0,
        leads: leadsCountRes.count || 0,
      })
      setRecentLeads(leadsRes.data || [])

      try {
        const healthRes = await fetch('/api/internal/health')
        const healthData = await healthRes.json()
        setHealth(healthData)
      } catch {
        setHealth({ status: 'down' })
      }

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          const gateRes = await fetch('/api/admin/automation-gate', {
            headers: { Authorization: 'Bearer ' + session.access_token },
          })
          if (gateRes.ok) {
            const gateData = await gateRes.json()
            setAutomationEnabled(Boolean(gateData.enabled))
          }
        }
      } catch {
        // leave gate status unknown
      }

      setLoading(false)
    }
    load()
  }, [])

  const healthColor = health?.status === 'ok' || health?.status === 'healthy'
    ? '#10b981'
    : health?.status === 'degraded'
      ? '#f59e0b'
      : '#ef4444'

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Dashboard</h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
          Platform overview · contractors · pipeline · system health
        </p>
      </div>

      {automationEnabled === false ? (
        <div style={{
          ...adminPanelStyle(),
          padding: '16px 18px',
          marginBottom: '20px',
          borderLeft: '3px solid ' + adminTheme.warning,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: adminTheme.warning }}>
            ⚠️ AUTOMATION PAUSED
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: adminTheme.textMuted }}>
            Workers are not processing runs. Enable automation when pipeline is ready.
          </p>
          <button
            type="button"
            onClick={() => router.push('/admin/operations')}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: '1px solid ' + adminTheme.border,
              backgroundColor: adminTheme.surfaceRaised,
              color: adminTheme.accent,
              fontFamily: adminTheme.fontMono,
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Go to Operations →
          </button>
        </div>
      ) : automationEnabled === true ? (
        <div style={{
          ...adminPanelStyle(),
          padding: '14px 18px',
          marginBottom: '20px',
          borderLeft: '3px solid ' + adminTheme.success,
        }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: adminTheme.success }}>
            ✓ AUTOMATION ACTIVE
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: adminTheme.textMuted }}>
            Workers are processing runs normally.
          </p>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Companies', value: stats.companies, color: '#3b82f6', href: '/admin/companies' },
          { label: 'Total Jobs', value: stats.jobs, color: adminTheme.text, href: '/admin/jobs' },
          { label: 'Active Automation', value: stats.activeRuns, color: '#f59e0b', href: '/admin/jobs' },
          { label: 'Leads', value: stats.leads, color: '#10b981', href: '/admin/leads' },
        ].map(stat => (
          <div
            key={stat.label}
            style={{ ...adminStatCardStyle(stat.color), cursor: 'pointer' }}
            onClick={() => router.push(stat.href)}
          >
            <p style={{ fontSize: '10px', color: adminTheme.textDim, margin: '0 0 6px 0', fontFamily: adminTheme.fontMono, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {stat.label}
            </p>
            <p style={{ fontSize: '28px', fontWeight: '700', color: stat.color, margin: 0, fontFamily: adminTheme.fontMono }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Jobs submitted today', value: stats.jobsToday },
          { label: 'NOCs generated', value: stats.nocGenerated },
          { label: 'Permits submitted', value: stats.permitsSubmitted },
        ].map(stat => (
          <div key={stat.label} style={adminStatCardStyle('#64748b')}>
            <p style={{ fontSize: '10px', color: adminTheme.textDim, margin: '0 0 6px 0', fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
              {stat.label}
            </p>
            <p style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0, fontFamily: adminTheme.fontMono }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={adminPanelStyle()}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '12px', fontWeight: '600', color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
              System Health
            </h2>
            <button
              onClick={() => router.push('/admin/system')}
              style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', fontFamily: adminTheme.fontMono }}
            >
              View details →
            </button>
          </div>
          <div style={{ padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: healthColor }} />
              <span style={{ fontSize: '14px', fontWeight: '600', color: adminTheme.text, textTransform: 'uppercase', fontFamily: adminTheme.fontMono }}>
                {health?.status || 'unknown'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', fontFamily: adminTheme.fontMono }}>
              <div style={{ color: adminTheme.textDim }}>Database</div>
              <div style={{ color: health?.database ? '#10b981' : '#ef4444' }}>{health?.database ? 'OK' : 'DOWN'}</div>
              <div style={{ color: adminTheme.textDim }}>Permit worker</div>
              <div style={{ color: health?.workers?.permit ? '#10b981' : '#ef4444' }}>{health?.workers?.permit ? 'UP' : 'STALE'}</div>
              <div style={{ color: adminTheme.textDim }}>NOC/Proof worker</div>
              <div style={{ color: health?.workers?.nocProof ? '#10b981' : '#ef4444' }}>{health?.workers?.nocProof ? 'UP' : 'STALE'}</div>
              <div style={{ color: adminTheme.textDim }}>Stuck jobs</div>
              <div style={{ color: adminTheme.text }}>{health?.stuckJobs ?? '—'}</div>
            </div>
          </div>
        </div>

        <div style={adminPanelStyle()}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '12px', fontWeight: '600', color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
              Recent Leads
            </h2>
            <button
              onClick={() => router.push('/admin/leads')}
              style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', fontFamily: adminTheme.fontMono }}
            >
              View all →
            </button>
          </div>
          {recentLeads.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: adminTheme.textDim, fontSize: '12px' }}>No leads yet</div>
          ) : (
            <div>
              {recentLeads.map((lead, i) => (
                <div
                  key={lead.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: i < recentLeads.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: adminTheme.text }}>{lead.name}</p>
                      <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: adminTheme.textMuted }}>{lead.company || lead.email}</p>
                    </div>
                    <span style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, whiteSpace: 'nowrap' }}>
                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
        <button
          onClick={() => router.push('/admin/companies/new')}
          style={{
            padding: '10px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}
        >
          + Onboard Contractor
        </button>
        <button
          onClick={() => router.push('/admin/jobs')}
          style={{
            padding: '10px 16px', backgroundColor: adminTheme.surface, color: adminTheme.text,
            border: '1px solid ' + adminTheme.border, borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
          }}
        >
          View All Jobs
        </button>
      </div>
    </div>
  )
}
