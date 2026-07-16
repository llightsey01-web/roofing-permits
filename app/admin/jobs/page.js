'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../lib/ui/admin-theme'

const permitStatusConfig = {
  draft: { bg: '#1e293b', text: '#94a3b8', label: 'Draft' },
  ready: { bg: '#1e3a5f', text: '#93c5fd', label: 'Ready' },
  automation_running: { bg: '#422006', text: '#fcd34d', label: 'Running' },
  needs_review: { bg: '#422006', text: '#fbbf24', label: 'Review' },
  needs_correction: { bg: '#450a0a', text: '#fca5a5', label: 'Correction' },
  approved: { bg: '#064e3b', text: '#6ee7b7', label: 'Approved' },
  submitted: { bg: '#064e3b', text: '#34d399', label: 'Submitted' },
  permit_issued: { bg: '#14532d', text: '#86efac', label: 'Issued' },
  on_hold: { bg: '#450a0a', text: '#fca5a5', label: 'On hold' },
  cancelled: { bg: '#1e293b', text: '#64748b', label: 'Cancelled' },
}

const nocStatusConfig = {
  not_started: { bg: '#1e293b', text: '#64748b', label: 'Not started' },
  generated: { bg: '#1e3a5f', text: '#93c5fd', label: 'Generated' },
  queued_for_notarization: { bg: '#1e3a5f', text: '#60a5fa', label: 'Queued' },
  sent_to_homeowner: { bg: '#1e3a5f', text: '#93c5fd', label: 'Sent' },
  sent_for_notarization: { bg: '#422006', text: '#fcd34d', label: 'Awaiting sig' },
  signed: { bg: '#064e3b', text: '#6ee7b7', label: 'Signed' },
  notarized: { bg: '#064e3b', text: '#34d399', label: 'Notarized' },
  submitted_to_erecord: { bg: '#312e81', text: '#a5b4fc', label: 'eRecord' },
  recorded: { bg: '#14532d', text: '#86efac', label: 'Recorded' },
  error: { bg: '#450a0a', text: '#fca5a5', label: 'Error' },
}

export default function AdminJobsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState([])
  const [companies, setCompanies] = useState({})
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: jobRows }, { data: companyRows }] = await Promise.all([
        supabase.from('jobs').select('id, company_id, property_address, property_city, property_state, property_zip, owner_name, job_status, noc_status, created_at, updated_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('companies').select('id, name'),
      ])
      const map = {}
      ;(companyRows || []).forEach(c => { map[c.id] = c.name })
      setCompanies(map)
      setJobs(jobRows || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter(j => {
      if (companyFilter !== 'all' && j.company_id !== companyFilter) return false
      if (statusFilter !== 'all' && j.job_status !== statusFilter) return false
      if (!q) return true
      return [j.property_address, j.owner_name, companies[j.company_id]]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    })
  }, [jobs, companyFilter, statusFilter, search, companies])

  const inputStyle = {
    padding: '8px 12px', border: '1px solid ' + adminTheme.border, borderRadius: '6px',
    fontSize: '13px', backgroundColor: adminTheme.surfaceRaised, color: adminTheme.text,
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: adminTheme.textMuted }}>Loading jobs...</div>
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1280px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Jobs</h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
          All jobs across all contractor companies
        </p>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: '200px' }} placeholder="Search address, owner, company..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={inputStyle} value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="all">All companies</option>
          {Object.entries(companies).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select style={inputStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.keys(permitStatusConfig).map(k => <option key={k} value={k}>{permitStatusConfig[k].label}</option>)}
        </select>
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '11px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Jobs ({filtered.length})
          </h2>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: adminTheme.textDim }}>No jobs match filters</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                {['Address', 'Company', 'Status', 'NOC', 'Created', 'Updated'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((job, i) => {
                const p = permitStatusConfig[job.job_status] || permitStatusConfig.draft
                const n = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started
                return (
                  <tr
                    key={job.id}
                    onClick={() => router.push('/admin/jobs/' + job.id)}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = adminTheme.surfaceRaised }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <td style={{ padding: '12px 14px' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: adminTheme.text }}>{job.property_address}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: adminTheme.textDim }}>{job.property_city}, {job.property_state}</p>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{companies[job.company_id] || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: p.bg, color: p.text }}>{p.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: n.bg, color: n.text }}>{n.label}</span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                      {job.created_at ? new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                      {job.updated_at ? new Date(job.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
