'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../../lib/ui/admin-theme'

function statusStyle(status) {
  const map = {
    queued: { bg: '#1e293b', text: '#94a3b8' },
    running: { bg: '#422006', text: '#fcd34d' },
    waiting: { bg: '#1e3a5f', text: '#93c5fd' },
    paused: { bg: '#312e81', text: '#a5b4fc' },
    failed: { bg: '#450a0a', text: '#fca5a5' },
    completed: { bg: '#064e3b', text: '#6ee7b7' },
    cancelled: { bg: '#1e293b', text: '#64748b' },
    pending: { bg: '#1e293b', text: '#94a3b8' },
    succeeded: { bg: '#064e3b', text: '#6ee7b7' },
    skipped: { bg: '#1e293b', text: '#64748b' },
    compensated: { bg: '#422006', text: '#fbbf24' },
  }
  return map[status] || map.queued
}

function Badge({ status }) {
  const st = statusStyle(status)
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      backgroundColor: st.bg,
      color: st.text,
      fontSize: '11px',
      fontFamily: adminTheme.fontMono,
    }}>
      {status || '—'}
    </span>
  )
}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function Section({ title, children, right }) {
  return (
    <div style={Object.assign({}, adminPanelStyle(), { marginBottom: '16px' })}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 14px',
        borderBottom: '1px solid ' + adminTheme.border,
      }}>
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.06em',
          color: adminTheme.textDim,
          fontFamily: adminTheme.fontMono,
          fontWeight: 600,
        }}>
          {title}
        </div>
        {right || null}
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  )
}

export default function AdminWorkflowRunPage() {
  const router = useRouter()
  const params = useParams()
  const runId = params && params.runId
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [restartStep, setRestartStep] = useState('')
  const [tab, setTab] = useState('timeline')

  const load = useCallback(async function () {
    if (!runId) return
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/login')
        return
      }
      const res = await fetch('/api/admin/workflows/' + runId, {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error || 'Failed to load run')
      } else {
        setData(payload)
        setError('')
        setRestartStep(function (prev) {
          if (prev) return prev
          return (payload.run && payload.run.current_step_key) || ''
        })
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [runId, router])

  useEffect(function () {
    setLoading(true)
    load()
    const timer = setInterval(load, 15000)
    return function () { clearInterval(timer) }
  }, [load])

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session && session.access_token
  }

  async function callAction(action, body) {
    if (action === 'cancel' && !window.confirm('Cancel this workflow run?')) return
    setBusy(action)
    setMessage('')
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/workflows/' + runId + '/' + action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(body || {}),
      })
      const payload = await res.json()
      if (!res.ok) {
        setMessage(payload.error || 'Action failed')
      } else {
        setMessage(action + ' succeeded')
        await load()
      }
    } catch (err) {
      setMessage(err.message)
    }
    setBusy('')
  }

  async function exportRun() {
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/workflows/' + runId + '/export', {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) {
        const payload = await res.json()
        setMessage(payload.error || 'Export failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'workflow-run-' + runId + '.json'
      a.click()
      URL.revokeObjectURL(url)
      setMessage('Export downloaded')
    } catch (err) {
      setMessage(err.message)
    }
  }

  const btn = function (color) {
    return {
      padding: '7px 10px',
      fontSize: '12px',
      borderRadius: '5px',
      border: '1px solid ' + adminTheme.border,
      backgroundColor: adminTheme.surfaceRaised,
      color: color || adminTheme.text,
      cursor: 'pointer',
      fontFamily: adminTheme.fontMono,
    }
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: adminTheme.textMuted }}>
        Loading workflow run...
      </div>
    )
  }

  if (error && !data) {
    return (
      <div style={{ padding: '28px' }}>
        <button
          type="button"
          onClick={function () { router.push('/admin/workflows') }}
          style={{
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            fontSize: '12px',
            cursor: 'pointer',
            padding: 0,
            marginBottom: '8px',
            fontFamily: adminTheme.fontMono,
          }}
        >
          ← Workflows
        </button>
        <div style={{ color: adminTheme.danger }}>{error}</div>
      </div>
    )
  }

  const run = data.run
  const timeline = []
    .concat((data.events || []).map(function (e) {
      return {
        at: e.created_at,
        kind: 'event',
        title: e.event_name,
        detail: e.source || '',
        raw: e,
      }
    }))
    .concat((data.stepHistory || []).map(function (h) {
      return {
        at: h.created_at,
        kind: 'step',
        title: (h.event_type || 'step') + (h.message ? ' — ' + h.message : ''),
        detail: (h.from_status || '') + ' → ' + (h.to_status || ''),
        raw: h,
      }
    }))
    .sort(function (a, b) {
      return new Date(b.at).getTime() - new Date(a.at).getTime()
    })

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1200px' }}>
      <button
        type="button"
        onClick={function () { router.push('/admin/workflows') }}
        style={{
          background: 'none',
          border: 'none',
          color: '#3b82f6',
          fontSize: '12px',
          cursor: 'pointer',
          padding: 0,
          marginBottom: '8px',
          fontFamily: adminTheme.fontMono,
        }}
      >
        ← Workflows
      </button>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
        marginBottom: '18px',
      }}>
        <div>
          <div style={{
            fontSize: '11px',
            color: adminTheme.textDim,
            fontFamily: adminTheme.fontMono,
            letterSpacing: '0.06em',
            marginBottom: '6px',
          }}>
            {run.workflow_key} · v{run.workflow_version}
          </div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: adminTheme.text }}>
            Run {String(run.id).slice(0, 8)}
          </h1>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge status={run.status} />
            {run.current_step_key && (
              <span style={{ fontSize: '12px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono }}>
                step: {run.current_step_key}
              </span>
            )}
            {run.pause_reason && (
              <span style={{ fontSize: '12px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                pause: {run.pause_reason}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button type="button" style={btn(adminTheme.success)} disabled={!!busy} onClick={function () { callAction('resume') }}>
            Resume
          </button>
          <button type="button" style={btn(adminTheme.warning)} disabled={!!busy} onClick={function () { callAction('retry', { stepKey: run.current_step_key }) }}>
            Retry step
          </button>
          <button type="button" style={btn('#a5b4fc')} disabled={!!busy} onClick={function () { callAction('force-step') }}>
            Force next
          </button>
          <button type="button" style={btn(adminTheme.danger)} disabled={!!busy} onClick={function () { callAction('cancel') }}>
            Cancel
          </button>
          <button type="button" style={btn('#60a5fa')} onClick={exportRun}>
            Export JSON
          </button>
        </div>
      </div>

      {message && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(59,130,246,0.12)',
          color: '#93c5fd',
          fontSize: '12px',
          fontFamily: adminTheme.fontMono,
        }}>
          {message}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <div style={adminPanelStyle()}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>JOB</div>
            <div style={{ marginTop: '6px', color: adminTheme.text, fontSize: '13px' }}>
              {data.job && data.job.property_address ? data.job.property_address : (run.job_id || '—')}
            </div>
            {run.job_id && (
              <button
                type="button"
                onClick={function () { router.push('/admin/jobs/' + run.job_id) }}
                style={{
                  marginTop: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#60a5fa',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontFamily: adminTheme.fontMono,
                }}
              >
                Open job →
              </button>
            )}
          </div>
        </div>
        <div style={adminPanelStyle()}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>COMPANY</div>
            <div style={{ marginTop: '6px', color: adminTheme.text, fontSize: '13px' }}>
              {data.company && data.company.name ? data.company.name : '—'}
            </div>
          </div>
        </div>
        <div style={adminPanelStyle()}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>TIMESTAMPS</div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, lineHeight: 1.6 }}>
              created {formatWhen(run.created_at)}<br />
              updated {formatWhen(run.updated_at)}<br />
              {run.error_message ? <span style={{ color: adminTheme.danger }}>error: {run.error_message}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <Section
        title="RESTART FROM STEP"
        right={
          <button
            type="button"
            style={btn(adminTheme.warning)}
            disabled={!restartStep || !!busy}
            onClick={function () {
              if (!window.confirm('Reset from ' + restartStep + ' and re-run forward?')) return
              callAction('restart-from', { stepKey: restartStep })
            }}
          >
            Restart
          </button>
        }
      >
        <select
          value={restartStep}
          onChange={function (e) { setRestartStep(e.target.value) }}
          style={{
            padding: '8px 12px',
            border: '1px solid ' + adminTheme.border,
            borderRadius: '6px',
            fontSize: '13px',
            backgroundColor: adminTheme.surfaceRaised,
            color: adminTheme.text,
            fontFamily: adminTheme.fontMono,
            minWidth: '260px',
          }}
        >
          {(data.steps || []).map(function (s) {
            return (
              <option key={s.step_key} value={s.step_key}>
                {s.sequence_order}. {s.step_key} ({s.status})
              </option>
            )
          })}
        </select>
      </Section>

      <Section title="STEPS">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                {['#', 'Key', 'Type', 'Status', 'Attempts', 'Error'].map(function (h) {
                  return (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '8px',
                      color: adminTheme.textDim,
                      fontFamily: adminTheme.fontMono,
                      fontSize: '10px',
                    }}>
                      {h}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {(data.steps || []).map(function (s) {
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                    <td style={{ padding: '8px', color: adminTheme.textDim }}>{s.sequence_order}</td>
                    <td style={{ padding: '8px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>{s.step_key}</td>
                    <td style={{ padding: '8px', color: adminTheme.textMuted }}>{s.step_type}</td>
                    <td style={{ padding: '8px' }}><Badge status={s.status} /></td>
                    <td style={{ padding: '8px', color: adminTheme.textMuted }}>{s.attempt_count || 0}/{s.max_attempts || '—'}</td>
                    <td style={{ padding: '8px', color: adminTheme.danger, maxWidth: '280px' }}>{s.error_message || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {['timeline', 'logs', 'artifacts', 'activities', 'overrides'].map(function (t) {
          const active = tab === t
          return (
            <button
              key={t}
              type="button"
              onClick={function () { setTab(t) }}
              style={{
                padding: '6px 10px',
                borderRadius: '5px',
                border: '1px solid ' + adminTheme.border,
                backgroundColor: active ? adminTheme.navActive : adminTheme.surface,
                color: active ? adminTheme.text : adminTheme.textMuted,
                cursor: 'pointer',
                fontFamily: adminTheme.fontMono,
                fontSize: '11px',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      {tab === 'timeline' && (
        <Section title="TIMELINE">
          {timeline.length === 0 ? (
            <div style={{ color: adminTheme.textMuted }}>No events yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {timeline.slice(0, 80).map(function (item, idx) {
                return (
                  <div key={idx} style={{
                    borderLeft: '2px solid ' + adminTheme.border,
                    paddingLeft: '12px',
                  }}>
                    <div style={{ fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                      {formatWhen(item.at)} · {item.kind}
                    </div>
                    <div style={{ fontSize: '13px', color: adminTheme.text, marginTop: '2px' }}>{item.title}</div>
                    {item.detail ? (
                      <div style={{ fontSize: '11px', color: adminTheme.textMuted, marginTop: '2px' }}>{item.detail}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {tab === 'logs' && (
        <Section title="LOGS">
          {(data.logs || []).length === 0 ? (
            <div style={{ color: adminTheme.textMuted }}>No logs.</div>
          ) : (
            <div style={{
              fontFamily: adminTheme.fontMono,
              fontSize: '11px',
              maxHeight: '480px',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              {(data.logs || []).map(function (log) {
                const color =
                  log.level === 'error' ? adminTheme.danger :
                    log.level === 'warn' ? adminTheme.warning :
                      adminTheme.textMuted
                return (
                  <div key={log.id}>
                    <span style={{ color: adminTheme.textDim }}>{formatWhen(log.created_at)}</span>
                    {' '}
                    <span style={{ color: color }}>[{log.level}]</span>
                    {' '}
                    <span style={{ color: adminTheme.text }}>{log.message}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {tab === 'artifacts' && (
        <Section title="ARTIFACTS">
          {(data.artifacts || []).length === 0 ? (
            <div style={{ color: adminTheme.textMuted }}>No artifacts.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(data.artifacts || []).map(function (a) {
                return (
                  <div key={a.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                    borderBottom: '1px solid ' + adminTheme.borderSubtle,
                    paddingBottom: '8px',
                  }}>
                    <div>
                      <div style={{ color: adminTheme.text, fontSize: '13px' }}>{a.name}</div>
                      <div style={{ color: adminTheme.textDim, fontSize: '11px', fontFamily: adminTheme.fontMono }}>
                        {a.artifact_type} · {a.storage_path || 'no path'}
                      </div>
                    </div>
                    {a.signed_url ? (
                      <a href={a.signed_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: '12px' }}>
                        Open
                      </a>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {tab === 'activities' && (
        <Section title="ACTIVITIES">
          {(data.activities || []).length === 0 ? (
            <div style={{ color: adminTheme.textMuted }}>No activities.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                    {['Type', 'Status', 'Legacy run', 'Created'].map(function (h) {
                      return (
                        <th key={h} style={{
                          textAlign: 'left',
                          padding: '8px',
                          color: adminTheme.textDim,
                          fontFamily: adminTheme.fontMono,
                          fontSize: '10px',
                        }}>
                          {h}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(data.activities || []).map(function (a) {
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                        <td style={{ padding: '8px', fontFamily: adminTheme.fontMono }}>{a.activity_type}</td>
                        <td style={{ padding: '8px' }}><Badge status={a.status} /></td>
                        <td style={{ padding: '8px', color: adminTheme.textMuted }}>{a.legacy_run_id ? String(a.legacy_run_id).slice(0, 8) : '—'}</td>
                        <td style={{ padding: '8px', color: adminTheme.textDim }}>{formatWhen(a.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'overrides' && (
        <Section title="MANUAL OVERRIDES">
          {(data.overrides || []).length === 0 ? (
            <div style={{ color: adminTheme.textMuted }}>No overrides.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(data.overrides || []).map(function (o) {
                return (
                  <div key={o.id} style={{ fontSize: '12px' }}>
                    <span style={{ fontFamily: adminTheme.fontMono, color: adminTheme.textDim }}>{formatWhen(o.created_at)}</span>
                    {' '}
                    <span style={{ color: adminTheme.text }}>{o.action}</span>
                    {o.reason ? <span style={{ color: adminTheme.textMuted }}> — {o.reason}</span> : null}
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
