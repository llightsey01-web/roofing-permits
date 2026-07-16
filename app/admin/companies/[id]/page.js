'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../../lib/ui/admin-theme'

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

export default function CompanyDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [company, setCompany] = useState(null)
  const [jobs, setJobs] = useState([])
  const [runs, setRuns] = useState([])
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [edit, setEdit] = useState({})

  async function load() {
    const supabase = createClient()
    const [{ data: companyRow }, { data: jobRows }, { data: runRows }, { data: credRows }] = await Promise.all([
      supabase.from('companies').select('*').eq('id', id).single(),
      supabase.from('jobs').select('id, property_address, property_city, job_status, noc_status, created_at, updated_at, owner_name').eq('company_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('automation_runs').select('id, job_id, run_type, run_status, error_message, created_at, completed_at').eq('company_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('company_credentials').select('id, provider, credential_type, is_active, ahj_id, created_at').eq('company_id', id),
    ])

    // automation_runs may not have company_id — fallback via job ids
    let resolvedRuns = runRows || []
    if ((!runRows || runRows.length === 0) && jobRows?.length) {
      const jobIds = jobRows.map(j => j.id)
      const { data: fallbackRuns } = await supabase
        .from('automation_runs')
        .select('id, job_id, run_type, run_status, error_message, created_at, completed_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false })
        .limit(20)
      resolvedRuns = fallbackRuns || []
    }

    setCompany(companyRow)
    setEdit({
      name: companyRow?.name || '',
      primary_email: companyRow?.primary_email || '',
      phone: companyRow?.phone || '',
      notes: companyRow?.notes || '',
      subscription_plan: companyRow?.subscription_plan || 'starter',
      subscription_status: companyRow?.subscription_status || 'trial',
    })
    setJobs(jobRows || [])
    setRuns(resolvedRuns)
    setCredentials(credRows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (id) load()
  }, [id])

  async function saveCompany() {
    setSaving(true)
    setMessage('')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/companies/' + id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify(edit),
    })
    const payload = await res.json()
    if (!res.ok) {
      setMessage(payload.error || 'Save failed')
    } else {
      setMessage('Saved')
      setCompany(payload.company)
    }
    setSaving(false)
  }

  async function setActive(isActive) {
    setSaving(true)
    setMessage('')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/companies/' + id, {
      method: isActive ? 'PATCH' : 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: isActive ? JSON.stringify({ is_active: true, subscription_status: 'active', onboarding_status: 'complete' }) : undefined,
    })
    const payload = await res.json()
    if (!res.ok) {
      setMessage(payload.error || 'Update failed')
    } else {
      setMessage(isActive ? 'Company activated' : 'Company suspended')
      await load()
    }
    setSaving(false)
  }

  async function resendOnboardingEmail() {
    setSaving(true)
    setMessage('')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/companies/' + id + '/resend-onboarding', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
      },
    })
    const payload = await res.json()
    if (!res.ok) {
      setMessage(payload.error || 'Failed to resend onboarding email')
    } else {
      setMessage('Onboarding email resent to ' + (payload.emailed || 'owner'))
    }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', border: '1px solid ' + adminTheme.border,
    borderRadius: '6px', fontSize: '13px', backgroundColor: adminTheme.surfaceRaised, color: adminTheme.text, boxSizing: 'border-box',
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: adminTheme.textMuted }}>Loading company...</div>
  }

  if (!company) {
    return <div style={{ padding: '48px', textAlign: 'center', color: '#ef4444' }}>Company not found</div>
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      <button onClick={() => router.push('/admin/companies')} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', padding: 0, marginBottom: '8px', fontFamily: adminTheme.fontMono }}>
        ← Companies
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>{company.name}</h1>
          <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0', fontFamily: adminTheme.fontMono }}>{company.id}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={resendOnboardingEmail}
            disabled={saving}
            style={{ padding: '8px 12px', backgroundColor: '#f97316', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
          >
            Resend Onboarding Email
          </button>
          {company.is_active === false ? (
            <button onClick={() => setActive(true)} disabled={saving} style={{ padding: '8px 12px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              Activate
            </button>
          ) : (
            <button onClick={() => setActive(false)} disabled={saving} style={{ padding: '8px 12px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              Suspend
            </button>
          )}
        </div>
      </div>

      {message && <p style={{ color: message.includes('fail') ? '#ef4444' : '#10b981', fontSize: '13px', marginBottom: '12px' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <div style={adminStatCardStyle('#3b82f6')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>JOBS</p><p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{jobs.length}</p></div>
        <div style={adminStatCardStyle('#f59e0b')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>PLAN</p><p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700, textTransform: 'capitalize' }}>{company.subscription_plan || 'starter'}</p></div>
        <div style={adminStatCardStyle('#10b981')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>STATUS</p><p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700 }}>{company.is_active === false ? 'INACTIVE' : (company.subscription_status || 'active').toUpperCase()}</p></div>
        <div style={adminStatCardStyle('#64748b')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>CREDENTIALS</p><p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{credentials.length}</p></div>
      </div>

      <div style={{ ...adminPanelStyle(), padding: '18px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: '0 0 14px' }}>Edit company</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div><label style={{ fontSize: '11px', color: adminTheme.textDim }}>Name</label><input style={inputStyle} value={edit.name} onChange={e => setEdit(p => ({ ...p, name: e.target.value }))} /></div>
          <div><label style={{ fontSize: '11px', color: adminTheme.textDim }}>Email</label><input style={inputStyle} value={edit.primary_email} onChange={e => setEdit(p => ({ ...p, primary_email: e.target.value }))} /></div>
          <div><label style={{ fontSize: '11px', color: adminTheme.textDim }}>Phone</label><input style={inputStyle} value={edit.phone} onChange={e => setEdit(p => ({ ...p, phone: e.target.value }))} /></div>
          <div><label style={{ fontSize: '11px', color: adminTheme.textDim }}>Plan</label>
            <select style={inputStyle} value={edit.subscription_plan} onChange={e => setEdit(p => ({ ...p, subscription_plan: e.target.value }))}>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="scale">Scale</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: adminTheme.textDim }}>Notes</label>
            <textarea style={{ ...inputStyle, minHeight: '70px' }} value={edit.notes} onChange={e => setEdit(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <button onClick={saveCompany} disabled={saving} style={{ marginTop: '12px', padding: '8px 14px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>

      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: 0 }}>AHJ credentials</h2>
        </div>
        {credentials.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim, fontSize: '13px' }}>No credential placeholders</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                  <td style={{ padding: '10px 18px', fontSize: '13px', color: adminTheme.text, fontFamily: adminTheme.fontMono }}>{c.provider}</td>
                  <td style={{ padding: '10px 18px', fontSize: '12px', color: adminTheme.textMuted }}>{c.credential_type}</td>
                  <td style={{ padding: '10px 18px', fontSize: '11px', color: c.is_active ? '#10b981' : '#ef4444' }}>{c.is_active ? 'ACTIVE' : 'INACTIVE'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: 0 }}>Jobs ({jobs.length})</h2>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim, fontSize: '13px' }}>No jobs yet</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Address', 'Status', 'NOC', 'Updated'].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const st = permitStatusConfig[job.job_status] || permitStatusConfig.draft
                return (
                  <tr key={job.id} onClick={() => router.push('/admin/jobs/' + job.id)} style={{ cursor: 'pointer', borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: adminTheme.text }}>{job.property_address}</td>
                    <td style={{ padding: '10px 14px' }}><span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', backgroundColor: st.bg, color: st.text }}>{st.label}</span></td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{job.noc_status || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: adminTheme.textDim }}>{job.updated_at ? new Date(job.updated_at).toLocaleDateString() : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: 0 }}>Recent automation runs</h2>
        </div>
        {runs.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim, fontSize: '13px' }}>No runs found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: adminTheme.text, fontFamily: adminTheme.fontMono }}>{run.run_type}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{run.run_status}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: adminTheme.textDim }}>{run.created_at ? new Date(run.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
