'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import { permitStatusConfig, nocStatusConfig, getRecordingStatusLabel } from '../../../lib/contractor/status-config'
import { contractorTheme, contractorCardStyle, contractorStatCardStyle } from '../../../lib/ui/contractor-theme'

export default function ContractorDashboardPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    try {
    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return
    if (!session) { router.replace('/login'); return }

    const { data: userData } = await supabase
      .from('users')
      .select('company_id, role')
      .eq('id', session.user.id)
      .single()

    if (userData?.role !== 'company_admin' || !userData?.company_id) {
      setError('Contractor access required')
      setLoading(false)
      return
    }

    const response = await fetch('/api/contractor/jobs', {
      headers: { Authorization: 'Bearer ' + session.access_token },
    })
    const result = await response.json()
    if (!response.ok) {
      setError(result.error || 'Failed to load jobs')
    } else {
      const scoped = (result.jobs || []).filter(
        job => job.company_id === userData.company_id || job.company_id === result.companyId
      )
      setJobs(scoped)
    }
    setLoading(false)
    } catch (err) {
      console.error('[auth] Contractor dashboard load failed:', err)
      router.replace('/login')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '64px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted, fontSize: '15px' }}>Loading your jobs...</p>
      </div>
    )
  }

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => !['draft', 'cancelled', 'permit_issued'].includes(j.job_status)).length,
    inProgress: jobs.filter(j => j.noc_status !== 'not_started' && j.noc_status !== 'recorded').length,
    issued: jobs.filter(j => j.job_status === 'permit_issued').length,
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>Welcome back</h1>
          <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
            Here&apos;s how your permit applications are progressing
          </p>
        </div>
        <button
          onClick={() => router.push('/contractor/jobs/new')}
          style={{
            fontSize: '15px', padding: '12px 22px',
            background: 'linear-gradient(135deg, #0284c7 0%, #059669 100%)',
            color: 'white', border: 'none', borderRadius: '999px',
            cursor: 'pointer', fontWeight: '600', boxShadow: contractorTheme.shadowCard,
          }}
        >
          + Start a new job
        </button>
      </div>

      {error && (
        <div style={{ padding: '14px 18px', backgroundColor: '#fef2f2', borderRadius: '12px', marginBottom: '24px', color: '#b91c1c', fontSize: '14px', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: 'Your jobs', value: stats.total, color: contractorTheme.text },
          { label: 'In progress', value: stats.active, color: contractorTheme.accent },
          { label: 'NOC underway', value: stats.inProgress, color: '#d97706' },
          { label: 'Permits issued', value: stats.issued, color: contractorTheme.success },
        ].map(stat => (
          <div key={stat.label} style={contractorStatCardStyle(stat.color)}>
            <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 8px 0' }}>{stat.label}</p>
            <p style={{ fontSize: '34px', fontWeight: '700', color: stat.color, margin: 0 }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 16px 0', color: contractorTheme.text }}>Your jobs</h2>

      {jobs.length === 0 ? (
        <div style={{ ...contractorCardStyle(), padding: '56px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏠</div>
          <p style={{ color: contractorTheme.text, fontSize: '17px', fontWeight: '600', margin: '0 0 8px 0' }}>
            No jobs yet
          </p>
          <p style={{ color: contractorTheme.textMuted, fontSize: '15px', margin: '0 0 20px 0', maxWidth: '360px', marginLeft: 'auto', marginRight: 'auto' }}>
            When you submit your first roofing permit application, you&apos;ll track every step right here.
          </p>
          <button
            onClick={() => router.push('/contractor/jobs/new')}
            style={{
              fontSize: '14px', padding: '10px 20px',
              backgroundColor: contractorTheme.accentSoft, color: contractorTheme.accent,
              border: '1px solid ' + contractorTheme.borderStrong, borderRadius: '999px',
              cursor: 'pointer', fontWeight: '600',
            }}
          >
            Create your first job
          </button>
        </div>
      ) : (
        <div style={{ ...contractorCardStyle(), overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f0f9ff', borderBottom: '1px solid ' + contractorTheme.border }}>
                {['Homeowner', 'Property', 'Status', 'NOC', 'Recording', 'Submitted', ''].map(h => (
                  <th key={h} style={{
                    padding: '14px 16px', textAlign: 'left', fontSize: '12px',
                    fontWeight: '600', color: contractorTheme.textMuted,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, i) => {
                const pStatus = permitStatusConfig[job.job_status] || permitStatusConfig.draft
                const nStatus = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started
                return (
                  <tr key={job.id} style={{ borderBottom: i < jobs.length - 1 ? '1px solid #f0f9ff' : 'none' }}>
                    <td style={{ padding: '16px', fontSize: '15px', fontWeight: '600', color: contractorTheme.textBody }}>{job.owner_name}</td>
                    <td style={{ padding: '16px' }}>
                      <p style={{ fontSize: '14px', margin: 0, color: contractorTheme.textBody }}>{job.property_address}</p>
                      <p style={{ fontSize: '12px', color: contractorTheme.textMuted, margin: '2px 0 0 0' }}>
                        {job.property_city}, {job.property_state}
                      </p>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', backgroundColor: pStatus.bg, color: pStatus.text, fontWeight: '500' }}>
                        {pStatus.label}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', backgroundColor: nStatus.bg, color: nStatus.text, fontWeight: '500' }}>
                        {nStatus.label}
                      </span>
                    </td>
                    <td style={{ padding: '16px', fontSize: '14px', color: contractorTheme.textMuted }}>
                      {getRecordingStatusLabel(job.noc_status)}
                    </td>
                    <td style={{ padding: '16px', fontSize: '13px', color: contractorTheme.textMuted }}>
                      {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <button
                        onClick={() => router.push('/contractor/jobs/' + job.id)}
                        style={{
                          fontSize: '13px', padding: '8px 16px',
                          border: 'none', borderRadius: '999px',
                          backgroundColor: contractorTheme.accentSoft,
                          cursor: 'pointer', color: contractorTheme.accent, fontWeight: '600',
                        }}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
