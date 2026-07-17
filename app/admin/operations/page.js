'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../lib/ui/admin-theme'

function formatElapsed(ms) {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m + 'm ' + rem + 's'
}

function statusIcon(runStatus) {
  if (runStatus === 'complete') return { emoji: '🟢', color: adminTheme.success, label: 'Success' }
  if (runStatus === 'running') return { emoji: '🟡', color: adminTheme.warning, label: 'Running' }
  if (runStatus === 'error' || runStatus === 'needs_review') return { emoji: '🔴', color: adminTheme.danger, label: 'Failed' }
  return { emoji: '⚪', color: adminTheme.textDim, label: 'Queued' }
}

function circuitBadge(state) {
  const status = state?.status || 'closed'
  if (status === 'closed') return { label: '✓', color: '#34d399', bg: 'rgba(52,211,153,0.12)' }
  if (status === 'half_open') return { label: '◐', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' }
  return { label: '✕', color: '#f87171', bg: 'rgba(248,113,113,0.12)' }
}

export default function AdminOperationsPage() {
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [gateEnabled, setGateEnabled] = useState(null)
  const [gateUpdatedAt, setGateUpdatedAt] = useState(null)
  const [gateBusy, setGateBusy] = useState(false)

  const loadGate = useCallback(async function (accessToken) {
    try {
      const res = await fetch('/api/admin/automation-gate', {
        headers: { Authorization: 'Bearer ' + accessToken },
      })
      const payload = await res.json()
      if (res.ok) {
        setGateEnabled(Boolean(payload.enabled))
        setGateUpdatedAt(payload.updatedAt || null)
      }
    } catch {
      // keep previous gate state
    }
  }, [])

  const load = useCallback(async function () {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/login')
        return
      }
      const res = await fetch('/api/admin/operations', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error || 'Failed to load operations')
      } else {
        setData(payload)
        setError('')
      }
      await loadGate(session.access_token)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [router, loadGate])

  useEffect(function () {
    load()
    const timer = setInterval(load, 30000)
    return function () { clearInterval(timer) }
  }, [load])

  async function toggleGate() {
    if (gateEnabled === null) return
    const next = !gateEnabled
    if (next && !window.confirm('Enable automation? Workers will start picking up queued runs immediately.')) {
      return
    }
    setGateBusy(true)
    setMessage('')
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/automation-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ enabled: next }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setMessage(payload.error || 'Failed to update automation gate')
      } else {
        setGateEnabled(Boolean(payload.enabled))
        setMessage(payload.message || (next ? 'Automation enabled' : 'Automation paused'))
        await loadGate(session.access_token)
      }
    } catch (err) {
      setMessage(err.message)
    }
    setGateBusy(false)
  }

  async function callAction(jobId, action) {
    setBusyId(jobId + ':' + action)
    setMessage('')
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/jobs/' + jobId + '/' + action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({}),
      })
      const payload = await res.json()
      if (!res.ok) setMessage(payload.error || action + ' failed')
      else {
        setMessage(action + ' OK')
        await load()
      }
    } catch (err) {
      setMessage(err.message)
    }
    setBusyId('')
  }

  if (loading && !data) {
    return <div style={{ padding: '48px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono }}>Loading operations center...</div>
  }

  const circuits = data?.circuits || {}
  const services = [
    { key: 'proof', label: 'Proof.com' },
    { key: 'epn', label: 'ePN' },
    { key: 'polk', label: 'Polk Portal' },
    { key: 'lee', label: 'Lee Portal' },
    { key: 'twocaptcha', label: '2Captcha' },
  ]

  const activeRuns = (data?.activeRuns || []).filter(function (r) {
    return r.run_status === 'running' || r.run_status === 'error' || r.run_status === 'queued'
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1200px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, color: adminTheme.text, margin: 0 }}>
        DART iQ Operations Center
      </h1>
      <p style={{ fontSize: '12px', color: adminTheme.textDim, margin: '6px 0 20px', fontFamily: adminTheme.fontMono }}>
        Mission control · auto-refresh 30s · {data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : '—'}
      </p>

      {error ? <p style={{ color: adminTheme.danger, marginBottom: '12px' }}>{error}</p> : null}
      {message ? <p style={{ color: adminTheme.success, marginBottom: '12px', fontFamily: adminTheme.fontMono, fontSize: '12px' }}>{message}</p> : null}

      <div style={{
        ...adminPanelStyle(),
        padding: '16px 18px',
        marginBottom: '18px',
        borderLeft: '3px solid ' + (gateEnabled ? adminTheme.success : adminTheme.warning),
      }}>
        <p style={{ margin: '0 0 10px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em' }}>
          AUTOMATION GATE
        </p>
        {gateEnabled === null ? (
          <p style={{ margin: 0, fontSize: '13px', color: adminTheme.textMuted }}>Loading gate status…</p>
        ) : gateEnabled ? (
          <>
            <p style={{ margin: '0 0 8px', fontSize: '14px', color: adminTheme.text, fontWeight: 600 }}>
              Status: 🟢 ACTIVE — Workers are processing runs normally
            </p>
            <button
              type="button"
              onClick={toggleGate}
              disabled={gateBusy}
              style={{
                marginTop: '4px',
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid ' + adminTheme.border,
                backgroundColor: adminTheme.surfaceRaised,
                color: adminTheme.warning,
                fontFamily: adminTheme.fontMono,
                fontSize: '12px',
                fontWeight: 600,
                cursor: gateBusy ? 'wait' : 'pointer',
              }}
            >
              {gateBusy ? 'Updating…' : 'Pause Automation'}
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 8px', fontSize: '14px', color: adminTheme.text, fontWeight: 600 }}>
              Status: 🔴 PAUSED — Workers will not pick up new runs
            </p>
            <button
              type="button"
              onClick={toggleGate}
              disabled={gateBusy}
              style={{
                marginTop: '4px',
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid rgba(52,211,153,0.35)',
                backgroundColor: 'rgba(52,211,153,0.12)',
                color: adminTheme.success,
                fontFamily: adminTheme.fontMono,
                fontSize: '12px',
                fontWeight: 600,
                cursor: gateBusy ? 'wait' : 'pointer',
              }}
            >
              {gateBusy ? 'Updating…' : 'Enable Automation'}
            </button>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: adminTheme.warning }}>
              ⚠️ Only enable when pipeline has been fully tested end-to-end.
            </p>
          </>
        )}
        {gateUpdatedAt ? (
          <p style={{ margin: '10px 0 0', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
            Last updated: {new Date(gateUpdatedAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <div style={{ ...adminPanelStyle(), padding: '16px 18px', marginBottom: '18px' }}>
        <p style={{ margin: '0 0 12px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em' }}>
          EXTERNAL SERVICES STATUS
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {services.map(function (svc) {
            const badge = circuitBadge(circuits[svc.key])
            return (
              <span key={svc.key} style={{
                padding: '8px 12px',
                borderRadius: '6px',
                backgroundColor: badge.bg,
                color: badge.color,
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: adminTheme.fontMono,
                border: '1px solid ' + adminTheme.border,
              }}>
                {svc.label} {badge.label}
              </span>
            )
          })}
        </div>
        <div style={{ marginTop: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono }}>
          {(data?.heartbeats || []).slice(0, 5).map(function (hb) {
            return (
              <span key={hb.worker_name}>
                {hb.worker_name}: {hb.last_poll_at ? new Date(hb.last_poll_at).toLocaleTimeString() : '—'}
              </span>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <div style={adminStatCardStyle('#818cf8')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>PERMIT QUEUE</p>
          <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{data?.queue?.permit ?? 0}</p>
        </div>
        <div style={adminStatCardStyle('#f59e0b')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>NOC/PROOF QUEUE</p>
          <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{data?.queue?.nocProof ?? 0}</p>
        </div>
        <div style={adminStatCardStyle('#34d399')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>COMPLETED TODAY</p>
          <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{data?.today?.completedRuns ?? 0}</p>
        </div>
        <div style={adminStatCardStyle('#f87171')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>FAILED TODAY</p>
          <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{data?.today?.failedRuns ?? 0}</p>
        </div>
      </div>

      <div style={{ ...adminPanelStyle(), padding: '16px 18px', marginBottom: '18px' }}>
        <p style={{ margin: '0 0 4px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
          COMPLETED TODAY
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: adminTheme.text }}>
          ✓ {data?.today?.permitsSubmitted ?? 0} permits submitted · ✓ {data?.today?.nocsGenerated ?? 0} NOCs generated · ✗ {data?.today?.failedRuns ?? 0} failed
        </p>
      </div>

      <div style={{ ...adminPanelStyle(), padding: '16px 18px' }}>
        <p style={{ margin: '0 0 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em' }}>
          ACTIVE RUNS ({activeRuns.length})
        </p>

        {activeRuns.length === 0 ? (
          <p style={{ color: adminTheme.textMuted, fontSize: '13px', margin: 0 }}>No active runs</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {activeRuns.map(function (run) {
              const st = statusIcon(run.run_status)
              const addr = run.job
                ? [run.job.property_address, run.job.property_city, run.job.property_state].filter(Boolean).join(', ')
                : run.job_id
              const busy = busyId.indexOf(run.job_id) === 0
              return (
                <div key={run.id} style={{
                  border: '1px solid ' + adminTheme.border,
                  borderRadius: '8px',
                  padding: '14px 16px',
                  backgroundColor: adminTheme.surfaceRaised,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: adminTheme.text }}>
                        Job: {addr}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: adminTheme.textMuted }}>
                        Company: {run.company_name || '—'}
                      </p>
                      <p style={{ margin: '8px 0 0', fontSize: '13px', color: st.color }}>
                        Status: {st.emoji} {st.label} — {run.run_type || 'permit'} · attempts {run.attempts || 0}/3
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                        Worker: {run.worker} · elapsed {formatElapsed(run.elapsed_ms)}
                      </p>
                      {run.error_message ? (
                        <p style={{ margin: '8px 0 0', fontSize: '12px', color: adminTheme.danger }}>
                          Error: {run.error_message}
                        </p>
                      ) : null}
                    </div>
                    {run.screenshot_path ? (
                      <div style={{
                        width: '72px',
                        height: '54px',
                        borderRadius: '4px',
                        backgroundColor: '#0f172a',
                        border: '1px solid ' + adminTheme.border,
                        fontSize: '9px',
                        color: adminTheme.textDim,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: '4px',
                      }} title={run.screenshot_path}>
                        forensics
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={function () { callAction(run.job_id, 'resume') }}
                      style={btnStyle('#6366f1')}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={function () { callAction(run.job_id, 'retry') }}
                      style={btnStyle('#f59e0b')}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={function () { callAction(run.job_id, 'escalate') }}
                      style={btnStyle('#f87171')}
                    >
                      Escalate to Manual
                    </button>
                    <button
                      type="button"
                      onClick={function () { router.push('/admin/jobs/' + run.job_id) }}
                      style={btnStyle('#64748b')}
                    >
                      View Forensics
                    </button>
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
    padding: '7px 12px',
    backgroundColor: bg,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  }
}
