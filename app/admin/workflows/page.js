'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../lib/ui/admin-theme'

const STATUS_FILTERS = [
  'all',
  'queued',
  'running',
  'waiting',
  'paused',
  'failed',
  'completed',
  'cancelled',
]

const WORKFLOW_FILTERS = ['all', 'epn', 'permit']

function statusStyle(status) {
  const map = {
    queued: { bg: '#1e293b', text: '#94a3b8' },
    running: { bg: '#422006', text: '#fcd34d' },
    waiting: { bg: '#1e3a5f', text: '#93c5fd' },
    paused: { bg: '#312e81', text: '#a5b4fc' },
    failed: { bg: '#450a0a', text: '#fca5a5' },
    completed: { bg: '#064e3b', text: '#6ee7b7' },
    cancelled: { bg: '#1e293b', text: '#64748b' },
    compensating: { bg: '#422006', text: '#fbbf24' },
  }
  return map[status] || map.queued
}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function shortId(id) {
  if (!id) return '—'
  return String(id).slice(0, 8)
}

export default function AdminWorkflowsPage() {
  const router = useRouter()
  const [runs, setRuns] = useState([])
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('all')
  const [workflowKey, setWorkflowKey] = useState('all')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async function () {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/login')
        return
      }

      const params = new URLSearchParams()
      if (status !== 'all') params.set('status', status)
      if (workflowKey !== 'all') params.set('workflow_key', workflowKey)
      if (q.trim()) params.set('q', q.trim())
      params.set('limit', '75')

      const res = await fetch('/api/admin/workflows?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error || 'Failed to load workflows')
      } else {
        setRuns(payload.runs || [])
        setCounts(payload.counts || {})
        setTotal(payload.total || 0)
        setError('')
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [router, status, workflowKey, q])

  useEffect(function () {
    setLoading(true)
    load()
    const timer = setInterval(load, 20000)
    return function () { clearInterval(timer) }
  }, [load])

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session && session.access_token
  }

  async function callAction(runId, action) {
    if (action === 'cancel' && !window.confirm('Cancel this workflow run?')) return
    setBusyId(runId + ':' + action)
    setMessage('')
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/workflows/' + runId + '/' + action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({}),
      })
      const payload = await res.json()
      if (!res.ok) {
        setMessage(payload.error || 'Action failed')
      } else {
        setMessage(action + ' ok — ' + shortId(runId))
        await load()
      }
    } catch (err) {
      setMessage(err.message)
    }
    setBusyId('')
  }

  const inputStyle = {
    padding: '8px 12px',
    border: '1px solid ' + adminTheme.border,
    borderRadius: '6px',
    fontSize: '13px',
    backgroundColor: adminTheme.surfaceRaised,
    color: adminTheme.text,
    fontFamily: adminTheme.fontMono,
  }

  const btnStyle = function (color) {
    return {
      padding: '5px 8px',
      fontSize: '11px',
      borderRadius: '4px',
      border: '1px solid ' + adminTheme.border,
      backgroundColor: adminTheme.surfaceRaised,
      color: color || adminTheme.textMuted,
      cursor: 'pointer',
      fontFamily: adminTheme.fontMono,
    }
  }

  const statItems = [
    { key: 'running', label: 'Running', color: adminTheme.warning },
    { key: 'waiting', label: 'Waiting', color: '#60a5fa' },
    { key: 'paused', label: 'Paused', color: adminTheme.accent },
    { key: 'failed', label: 'Failed', color: adminTheme.danger },
    { key: 'completed', label: 'Completed', color: adminTheme.success },
  ]

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1400px' }}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{
          fontSize: '11px',
          color: adminTheme.textDim,
          fontFamily: adminTheme.fontMono,
          letterSpacing: '0.06em',
          marginBottom: '6px',
        }}>
          WORKFLOW ENGINE
        </div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: adminTheme.text }}>
          Workflows
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: adminTheme.textMuted }}>
          Durable runs — resume, retry, cancel, and inspect timelines.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
        marginBottom: '18px',
      }}>
        {statItems.map(function (s) {
          return (
            <button
              key={s.key}
              type="button"
              onClick={function () { setStatus(s.key) }}
              style={Object.assign({}, adminStatCardStyle(s.color), {
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              })}
            >
              <div style={{ fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                {s.label.toUpperCase()}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: adminTheme.text, marginTop: '4px' }}>
                {counts[s.key] != null ? counts[s.key] : '—'}
              </div>
            </button>
          )
        })}
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '14px',
        alignItems: 'center',
      }}>
        <select value={status} onChange={function (e) { setStatus(e.target.value) }} style={inputStyle}>
          {STATUS_FILTERS.map(function (s) {
            return <option key={s} value={s}>{s}</option>
          })}
        </select>
        <select value={workflowKey} onChange={function (e) { setWorkflowKey(e.target.value) }} style={inputStyle}>
          {WORKFLOW_FILTERS.map(function (s) {
            return <option key={s} value={s}>{s === 'all' ? 'all workflows' : s}</option>
          })}
        </select>
        <input
          value={q}
          onChange={function (e) { setQ(e.target.value) }}
          placeholder="Search run id / job id / step"
          style={Object.assign({}, inputStyle, { minWidth: '240px' })}
        />
        <button type="button" onClick={load} style={btnStyle(adminTheme.navAccent)}>
          Refresh
        </button>
        <span style={{ fontSize: '12px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
          {total} total
        </span>
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

      {error && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(248,113,113,0.12)',
          color: adminTheme.danger,
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      <div style={adminPanelStyle()}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: adminTheme.textMuted }}>
            Loading workflows...
          </div>
        ) : runs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: adminTheme.textMuted }}>
            No workflow runs match these filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                  {['Status', 'Workflow', 'Job', 'Step', 'Updated', 'Actions'].map(function (h) {
                    return (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          color: adminTheme.textDim,
                          fontFamily: adminTheme.fontMono,
                          fontWeight: 600,
                          fontSize: '11px',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {h.toUpperCase()}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {runs.map(function (run) {
                  const st = statusStyle(run.status)
                  const canResume = run.status === 'waiting' || run.status === 'paused' || run.status === 'failed'
                  const canCancel = run.status !== 'completed' && run.status !== 'cancelled'
                  return (
                    <tr
                      key={run.id}
                      style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}
                    >
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: st.bg,
                          color: st.text,
                          fontSize: '11px',
                          fontFamily: adminTheme.fontMono,
                        }}>
                          {run.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>
                        <button
                          type="button"
                          onClick={function () { router.push('/admin/workflows/' + run.id) }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#60a5fa',
                            cursor: 'pointer',
                            padding: 0,
                            fontFamily: adminTheme.fontMono,
                            fontSize: '12px',
                          }}
                        >
                          {run.workflow_key} v{run.workflow_version}
                        </button>
                        <div style={{ color: adminTheme.textDim, fontSize: '10px', marginTop: '2px' }}>
                          {shortId(run.id)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', color: adminTheme.textMuted }}>
                        <div style={{ fontSize: '12px' }}>
                          {run.job && run.job.property_address
                            ? run.job.property_address
                            : shortId(run.job_id)}
                        </div>
                        <div style={{ fontSize: '11px', color: adminTheme.textDim }}>
                          {run.company && run.company.name ? run.company.name : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: adminTheme.fontMono, fontSize: '12px', color: adminTheme.text }}>
                        {run.current_step_key || '—'}
                        {run.pause_reason ? (
                          <div style={{ color: adminTheme.textDim, fontSize: '10px' }}>{run.pause_reason}</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: adminTheme.fontMono, fontSize: '11px', color: adminTheme.textDim }}>
                        {formatWhen(run.updated_at || run.created_at)}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            style={btnStyle('#60a5fa')}
                            onClick={function () { router.push('/admin/workflows/' + run.id) }}
                          >
                            Open
                          </button>
                          {canResume && (
                            <button
                              type="button"
                              disabled={busyId === run.id + ':resume'}
                              style={btnStyle(adminTheme.success)}
                              onClick={function () { callAction(run.id, 'resume') }}
                            >
                              Resume
                            </button>
                          )}
                          {(run.status === 'failed' || run.status === 'waiting') && (
                            <button
                              type="button"
                              disabled={busyId === run.id + ':retry'}
                              style={btnStyle(adminTheme.warning)}
                              onClick={function () { callAction(run.id, 'retry') }}
                            >
                              Retry
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              disabled={busyId === run.id + ':cancel'}
                              style={btnStyle(adminTheme.danger)}
                              onClick={function () { callAction(run.id, 'cancel') }}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
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
