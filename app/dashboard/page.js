'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { adminTheme, adminStatCardStyle, adminPanelStyle } from '../../lib/ui/admin-theme'

export default function DashboardPage() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return }

      const { data } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })

      setJobs(data || [])
      setLoading(false)
    })
  }, [router])

  const permitStatusConfig = {
    draft:              { bg: '#1e293b', text: '#94a3b8', label: 'Draft' },
    ready:              { bg: '#1e3a5f', text: '#93c5fd', label: 'Ready' },
    automation_running: { bg: '#422006', text: '#fcd34d', label: 'Running' },
    needs_review:       { bg: '#422006', text: '#fbbf24', label: 'Review' },
    needs_correction:   { bg: '#450a0a', text: '#fca5a5', label: 'Correction' },
    approved:           { bg: '#064e3b', text: '#6ee7b7', label: 'Approved' },
    submitted:          { bg: '#064e3b', text: '#34d399', label: 'Submitted' },
    permit_issued:      { bg: '#14532d', text: '#86efac', label: 'Issued' },
    on_hold:            { bg: '#450a0a', text: '#fca5a5', label: 'On hold' },
    cancelled:          { bg: '#1e293b', text: '#64748b', label: 'Cancelled' },
  }

  const nocStatusConfig = {
    not_started:              { bg: '#1e293b', text: '#64748b', label: 'Not started', dot: '#475569' },
    generated:                { bg: '#1e3a5f', text: '#93c5fd', label: 'Generated', dot: '#3b82f6' },
    queued_for_notarization:  { bg: '#1e3a5f', text: '#60a5fa', label: 'Queued', dot: '#2563eb' },
    sent_to_homeowner:        { bg: '#1e3a5f', text: '#93c5fd', label: 'Sent', dot: '#2563eb' },
    sent_for_notarization:    { bg: '#422006', text: '#fcd34d', label: 'Awaiting sig', dot: '#f59e0b' },
    signed:                   { bg: '#064e3b', text: '#6ee7b7', label: 'Signed', dot: '#10b981' },
    notarized:                { bg: '#064e3b', text: '#34d399', label: 'Notarized', dot: '#059669' },
    submitted_to_erecord:     { bg: '#312e81', text: '#a5b4fc', label: 'eRecord', dot: '#6366f1' },
    recorded:                 { bg: '#14532d', text: '#86efac', label: 'Recorded', dot: '#16a34a' },
    error:                    { bg: '#450a0a', text: '#fca5a5', label: 'Error', dot: '#ef4444' },
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>Loading queue...</p>
      </div>
    )
  }

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => !['draft', 'cancelled', 'permit_issued'].includes(j.job_status)).length,
    needsAttention: jobs.filter(j => ['needs_review', 'needs_correction', 'on_hold'].includes(j.job_status)).length,
    running: jobs.filter(j => j.job_status === 'automation_running').length,
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1280px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: adminTheme.text, margin: 0, letterSpacing: '-0.02em' }}>
            Operations Queue
          </h1>
          <p style={{ fontSize: '12px', color: adminTheme.textDim, margin: '4px 0 0 0', fontFamily: adminTheme.fontMono }}>
            Cross-company pipeline · automation · NOC · recording status
          </p>
        </div>
        <button
          onClick={() => router.push('/jobs/new')}
          style={{
            fontSize: '12px', padding: '8px 14px',
            backgroundColor: adminTheme.accentStrong,
            color: 'white', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontWeight: '600', fontFamily: adminTheme.fontMono,
          }}
        >
          + Manual intake
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {[
          { label: 'TOTAL IN QUEUE', value: stats.total, color: adminTheme.text },
          { label: 'ACTIVE RUNS', value: stats.active, color: adminTheme.accent },
          { label: 'AUTOMATION LIVE', value: stats.running, color: adminTheme.warning },
          { label: 'NEEDS OPERATOR', value: stats.needsAttention, color: adminTheme.danger },
        ].map(stat => (
          <div key={stat.label} style={adminStatCardStyle(stat.color)}>
            <p style={{ fontSize: '10px', color: adminTheme.textDim, margin: '0 0 6px 0', fontFamily: adminTheme.fontMono, letterSpacing: '0.06em' }}>
              {stat.label}
            </p>
            <p style={{ fontSize: '28px', fontWeight: '700', color: stat.color, margin: 0, lineHeight: 1, fontFamily: adminTheme.fontMono }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <h2 style={{ fontSize: '12px', fontWeight: '600', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          All permit runs ({jobs.length})
        </h2>
      </div>

      {jobs.length === 0 ? (
        <div style={{ ...adminPanelStyle(), padding: '48px', textAlign: 'center' }}>
          <p style={{ color: adminTheme.textDim, fontSize: '13px', fontFamily: adminTheme.fontMono, margin: 0 }}>
            Queue empty · trigger manual intake or wait for contractor submissions
          </p>
        </div>
      ) : (
        <div style={adminPanelStyle()}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: adminTheme.surfaceRaised, borderBottom: '1px solid ' + adminTheme.border }}>
                {['Owner', 'Property', 'Roof', 'Value', 'NOC', 'Permit', 'Created'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '600',
                    color: adminTheme.textDim, letterSpacing: '0.08em', textTransform: 'uppercase',
                    fontFamily: adminTheme.fontMono,
                  }}>{h}</th>
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
                      borderBottom: i < jobs.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none',
                      cursor: 'pointer', backgroundColor: adminTheme.surface,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = adminTheme.surfaceRaised }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = adminTheme.surface }}
                    onClick={() => router.push('/jobs/' + job.id)}
                  >
                    <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '600', color: adminTheme.text }}>{job.owner_name}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <p style={{ fontSize: '13px', color: adminTheme.text, margin: 0 }}>{job.property_address}</p>
                      <p style={{ fontSize: '11px', color: adminTheme.textDim, margin: '2px 0 0 0', fontFamily: adminTheme.fontMono }}>
                        {job.property_city}, {job.property_state} {job.property_zip}
                      </p>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{job.roof_type || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.text, fontFamily: adminTheme.fontMono }}>
                      {job.valuation ? '$' + Number(job.valuation).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', backgroundColor: nStatus.bg, color: nStatus.text, fontFamily: adminTheme.fontMono }}>
                        {nStatus.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', backgroundColor: pStatus.bg, color: pStatus.text, fontFamily: adminTheme.fontMono }}>
                        {pStatus.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                      {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
