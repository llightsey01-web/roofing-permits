'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)

      // Check role
      const { data: userData } = await supabase
        .from('users')
        .select('role, company_id')
        .eq('id', user.id)
        .single()

      if (userData?.role === 'super_admin') {
        setIsSuperAdmin(true)
        // Admin sees all jobs
        const { data } = await supabase
          .from('jobs')
          .select('*')
          .order('created_at', { ascending: false })
        setJobs(data || [])
      } else {
        // Company user sees only their jobs
        const { data } = await supabase
          .from('jobs')
          .select('*')
          .eq('company_id', userData?.company_id)
          .order('created_at', { ascending: false })
        setJobs(data || [])
      }

      setLoading(false)
    })
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const permitStatusConfig = {
    draft:              { bg: '#f1f5f9', text: '#475569', label: 'Draft' },
    ready:              { bg: '#dbeafe', text: '#1d4ed8', label: 'Ready' },
    automation_running: { bg: '#fef3c7', text: '#b45309', label: 'Running' },
    needs_review:       { bg: '#fef9c3', text: '#854d0e', label: 'Review needed' },
    needs_correction:   { bg: '#fee2e2', text: '#b91c1c', label: 'Needs correction' },
    approved:           { bg: '#dcfce7', text: '#15803d', label: 'Approved' },
    submitted:          { bg: '#d1fae5', text: '#065f46', label: 'Submitted' },
    permit_issued:      { bg: '#bbf7d0', text: '#14532d', label: 'Permit issued' },
    on_hold:            { bg: '#fee2e2', text: '#b91c1c', label: 'On hold' },
    cancelled:          { bg: '#f1f5f9', text: '#64748b', label: 'Cancelled' },
  }

  const nocStatusConfig = {
    not_started:              { bg: '#f1f5f9', text: '#94a3b8', label: 'Not started', dot: '#cbd5e1' },
    generated:                { bg: '#eff6ff', text: '#3b82f6', label: 'Generated', dot: '#3b82f6' },
    queued_for_notarization:  { bg: '#eff6ff', text: '#2563eb', label: 'Sent', dot: '#2563eb' },
    sent_for_notarization:    { bg: '#fef3c7', text: '#d97706', label: 'Awaiting signature', dot: '#f59e0b' },
    signed:                   { bg: '#d1fae5', text: '#059669', label: 'Signed', dot: '#10b981' },
    notarized:                { bg: '#d1fae5', text: '#047857', label: 'Notarized', dot: '#059669' },
    submitted_to_erecord:     { bg: '#e0e7ff', text: '#4338ca', label: 'At eRecord', dot: '#6366f1' },
    recorded:                 { bg: '#bbf7d0', text: '#14532d', label: 'Recorded ✓', dot: '#16a34a' },
    error:                    { bg: '#fee2e2', text: '#b91c1c', label: 'Error', dot: '#ef4444' },
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Loading...</p>
      </div>
    )
  }

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => !['draft', 'cancelled', 'permit_issued'].includes(j.job_status)).length,
    needsAttention: jobs.filter(j => ['needs_review', 'needs_correction', 'on_hold'].includes(j.job_status)).length,
    issued: jobs.filter(j => j.job_status === 'permit_issued').length,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>

      {/* Header */}
      <div style={{
        backgroundColor: '#0f172a', padding: '0 32px',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '28px', height: '28px', backgroundColor: '#3b82f6',
            borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'white', fontSize: '14px', fontWeight: '700' }}>A</span>
          </div>
          <span style={{ color: 'white', fontSize: '16px', fontWeight: '600', letterSpacing: '-0.3px' }}>AHJ-iQ</span>
          <span style={{ color: '#475569', fontSize: '14px', marginLeft: '8px' }}>Permit Management</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {isSuperAdmin && (
            <button
              onClick={() => router.push('/admin')}
              style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
            >
              Admin
            </button>
          )}
          <button
            onClick={() => router.push('/settings')}
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
          >
            Settings
          </button>
          <span style={{ fontSize: '13px', color: '#64748b' }}>{user?.email}</span>
          <button
            onClick={handleSignOut}
            style={{
              fontSize: '13px', padding: '6px 14px',
              border: '1px solid #334155', borderRadius: '6px',
              backgroundColor: 'transparent', color: '#94a3b8', cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
          {[
            { label: 'Total jobs', value: stats.total, color: '#0f172a' },
            { label: 'Active permits', value: stats.active, color: '#2563eb' },
            { label: 'Needs attention', value: stats.needsAttention, color: '#d97706' },
            { label: 'Permits issued', value: stats.issued, color: '#16a34a' },
          ].map(stat => (
            <div key={stat.label} style={{
              backgroundColor: 'white', border: '1px solid #e2e8f0',
              borderRadius: '12px', padding: '20px 24px',
            }}>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 8px 0' }}>{stat.label}</p>
              <p style={{ fontSize: '32px', fontWeight: '700', color: stat.color, margin: 0, lineHeight: 1 }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Jobs header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', margin: 0, color: '#0f172a' }}>
            Permit Applications
          </h2>
          <button
            onClick={() => router.push('/jobs/new')}
            style={{
              fontSize: '14px', padding: '10px 20px',
              backgroundColor: '#2563eb', color: 'white',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '500',
            }}
          >
            + New job
          </button>
        </div>

        {/* Jobs table */}
        {jobs.length === 0 ? (
          <div style={{
            backgroundColor: 'white', border: '1px solid #e2e8f0',
            borderRadius: '12px', padding: '64px', textAlign: 'center',
          }}>
            <p style={{ fontSize: '32px', margin: '0 0 12px 0' }}>📋</p>
            <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>
              No jobs yet. Click "New job" to create your first permit application.
            </p>
          </div>
        ) : (
          <div style={{
            backgroundColor: 'white', border: '1px solid #e2e8f0',
            borderRadius: '12px', overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['Owner', 'Property address', 'Roof type', 'Value', 'NOC status', 'Permit status', 'Date'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left',
                      fontSize: '12px', fontWeight: '600',
                      color: '#64748b', letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, i) => {
                  const pStatus = permitStatusConfig[job.job_status] || permitStatusConfig.draft
                  const nStatus = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started
                  return (
                    <tr
                      key={job.id}
                      style={{
                        borderBottom: i < jobs.length - 1 ? '1px solid #f1f5f9' : 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
                      onClick={() => router.push(`/jobs/${job.id}`)}
                    >
                      <td style={{ padding: '16px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                        {job.owner_name}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <p style={{ fontSize: '14px', color: '#1e293b', margin: 0, fontWeight: '500' }}>
                          {job.property_address}
                        </p>
                        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>
                          {job.property_city}, {job.property_state} {job.property_zip}
                        </p>
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px', color: '#475569' }}>
                        {job.roof_type || '—'}
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px', fontWeight: '500', color: '#0f172a' }}>
                        {job.valuation ? `$${Number(job.valuation).toLocaleString()}` : '—'}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            backgroundColor: nStatus.dot, flexShrink: 0,
                          }} />
                          <span style={{
                            fontSize: '12px', fontWeight: '500',
                            padding: '3px 8px', borderRadius: '20px',
                            backgroundColor: nStatus.bg, color: nStatus.text,
                          }}>
                            {nStatus.label}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{
                          fontSize: '12px', fontWeight: '500',
                          padding: '3px 8px', borderRadius: '20px',
                          backgroundColor: pStatus.bg, color: pStatus.text,
                        }}>
                          {pStatus.label}
                        </span>
                      </td>
                      <td style={{ padding: '16px', fontSize: '13px', color: '#94a3b8' }}>
                        {new Date(job.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric'
                        })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}