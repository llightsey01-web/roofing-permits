'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../../lib/ui/admin-theme'

export default function AdminJobDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [job, setJob] = useState(null)
  const [company, setCompany] = useState(null)
  const [runs, setRuns] = useState([])
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const supabase = createClient()
    const { data: jobRow } = await supabase.from('jobs').select('*').eq('id', id).single()
    setJob(jobRow)
    if (jobRow?.company_id) {
      const { data: companyRow } = await supabase.from('companies').select('id, name').eq('id', jobRow.company_id).single()
      setCompany(companyRow)
    }
    const { data: runRows } = await supabase
      .from('automation_runs')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(30)
    setRuns(runRows || [])
    const { data: actionRows } = await supabase
      .from('run_actions')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
    setActions(actionRows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (id) load()
  }, [id])

  async function patchJob(updates, label) {
    setBusy(true)
    setMessage('')
    const supabase = createClient()
    const { error } = await supabase.from('jobs').update(updates).eq('id', id)
    if (error) setMessage(error.message)
    else {
      setMessage(label)
      await load()
    }
    setBusy(false)
  }

  async function queueRun(runType) {
    setBusy(true)
    setMessage('')
    const supabase = createClient()
    const { error } = await supabase.from('automation_runs').insert({
      job_id: id,
      company_id: job?.company_id || null,
      run_type: runType,
      run_status: 'queued',
    })
    if (error) setMessage('Failed to queue run: ' + error.message)
    else {
      setMessage('Queued ' + runType)
      await load()
    }
    setBusy(false)
  }

  if (loading) return <div style={{ padding: '48px', color: adminTheme.textMuted }}>Loading job...</div>
  if (!job) return <div style={{ padding: '48px', color: '#ef4444' }}>Job not found</div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1000px' }}>
      <button onClick={() => router.push('/admin/jobs')} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', padding: 0, marginBottom: '8px', fontFamily: adminTheme.fontMono }}>
        ← Jobs
      </button>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>{job.property_address}</h1>
      <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 16px' }}>
        {company?.name || 'Unknown company'} · {job.owner_name}
      </p>

      {message && <p style={{ color: '#10b981', fontSize: '13px', marginBottom: '12px' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <div style={adminStatCardStyle('#3b82f6')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>JOB STATUS</p><p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700 }}>{job.job_status}</p></div>
        <div style={adminStatCardStyle('#f59e0b')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>NOC STATUS</p><p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 700 }}>{job.noc_status || 'not_started'}</p></div>
        <div style={adminStatCardStyle('#64748b')}><p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>RUNS</p><p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{runs.length}</p></div>
      </div>

      <div style={{ ...adminPanelStyle(), padding: '16px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: '0 0 12px' }}>Manual overrides</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => patchJob({ job_status: 'ready' }, 'Reset to ready/queued')} style={btnStyle('#3b82f6')}>Reset to queued</button>
          <button disabled={busy} onClick={() => patchJob({ job_status: 'needs_review' }, 'Marked needs review')} style={btnStyle('#f59e0b')}>Mark needs review</button>
          <button disabled={busy} onClick={() => queueRun('permit')} style={btnStyle('#64748b')}>Queue permit run</button>
          <button disabled={busy} onClick={() => queueRun('proof_send')} style={btnStyle('#64748b')}>Queue proof_send</button>
          <button disabled={busy} onClick={() => queueRun('noc')} style={btnStyle('#64748b')}>Queue NOC run</button>
        </div>
      </div>

      <div style={{ ...adminPanelStyle(), padding: '16px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: '0 0 12px' }}>Job info</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '8px', fontSize: '13px' }}>
          <div style={{ color: adminTheme.textDim }}>Job ID</div><div style={{ fontFamily: adminTheme.fontMono }}>{job.id}</div>
          <div style={{ color: adminTheme.textDim }}>Owner email</div><div>{job.owner_email || '—'}</div>
          <div style={{ color: adminTheme.textDim }}>Owner phone</div><div>{job.owner_phone || '—'}</div>
          <div style={{ color: adminTheme.textDim }}>Roof type</div><div>{job.roof_type || '—'}</div>
          <div style={{ color: adminTheme.textDim }}>Valuation</div><div>{job.valuation ? '$' + Number(job.valuation).toLocaleString() : '—'}</div>
          <div style={{ color: adminTheme.textDim }}>Created</div><div>{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</div>
          <div style={{ color: adminTheme.textDim }}>Updated</div><div>{job.updated_at ? new Date(job.updated_at).toLocaleString() : '—'}</div>
        </div>
      </div>

      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: 0 }}>Automation runs</h2>
        </div>
        {runs.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No automation runs</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {runs.map(run => (
                <tr key={run.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>{run.run_type}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{run.run_status}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: '#ef4444' }}>{run.error_message || ''}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: adminTheme.textDim }}>{run.created_at ? new Date(run.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.textMuted, textTransform: 'uppercase', margin: 0 }}>
            Audit trail ({actions.length})
          </h2>
        </div>
        {actions.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No run actions recorded yet</div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {actions.map(function (action) {
              const ok = action.status === 'success' || action.status === 'complete' || action.status === 'ok'
              const fail = action.status === 'error' || action.status === 'failed'
              const color = fail ? '#f87171' : ok ? '#34d399' : adminTheme.textMuted
              return (
                <div
                  key={action.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: '1px solid ' + adminTheme.borderSubtle,
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                    {action.created_at ? new Date(action.created_at).toLocaleString() : '—'}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', color: adminTheme.text, fontWeight: 600 }}>
                      <span style={{ color: color }}>●</span>{' '}
                      {action.step_name || action.action}
                      <span style={{ marginLeft: '8px', fontSize: '11px', color: color, fontFamily: adminTheme.fontMono, fontWeight: 500 }}>
                        {action.status}
                      </span>
                      {action.duration_ms != null ? (
                        <span style={{ marginLeft: '8px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                          {action.duration_ms}ms
                        </span>
                      ) : null}
                    </div>
                    {action.error_message ? (
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#f87171' }}>{action.error_message}</p>
                    ) : null}
                    {action.portal_response ? (
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, whiteSpace: 'pre-wrap' }}>
                        {String(action.portal_response).slice(0, 400)}
                      </p>
                    ) : null}
                    {action.screenshot_path ? (
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                        screenshot: {action.screenshot_path}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function btnStyle(bg) {
  return {
    padding: '8px 12px',
    backgroundColor: bg,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
  }
}
