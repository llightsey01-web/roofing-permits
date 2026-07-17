'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../lib/ui/admin-theme'

function colorForUptime(level) {
  if (level === 'green') return '#10b981'
  if (level === 'yellow') return '#f59e0b'
  if (level === 'red') return '#ef4444'
  return adminTheme.textDim
}

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return n + '%'
}

function formatMinutes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return n + ' min'
}

export default function AdminSystemPage() {
  const router = useRouter()
  const [health, setHealth] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [failedRuns, setFailedRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async function () {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/login')
        return
      }

      const [healthRes, metricsRes, failedRes] = await Promise.all([
        fetch('/api/internal/health').then(function (r) { return r.json() }).catch(function () {
          return { status: 'down' }
        }),
        fetch('/api/admin/system-metrics', {
          headers: { Authorization: 'Bearer ' + session.access_token },
        }).then(async function (r) {
          const body = await r.json()
          if (!r.ok) throw new Error(body.error || 'Failed to load system metrics')
          return body
        }),
        supabase
          .from('automation_runs')
          .select('id, job_id, run_type, error_message, completed_at, run_status')
          .eq('run_status', 'error')
          .order('completed_at', { ascending: false })
          .limit(25),
      ])

      setHealth(healthRes)
      setMetrics(metricsRes)
      setFailedRuns(failedRes.data || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [router])

  useEffect(function () {
    load()
  }, [load])

  if (loading) {
    return <div style={{ padding: '48px', color: adminTheme.textMuted }}>Loading system health...</div>
  }

  const healthColor = health?.status === 'ok' || health?.status === 'healthy'
    ? '#10b981'
    : health?.status === 'degraded'
      ? '#f59e0b'
      : '#ef4444'

  const overall = metrics?.success_rates?.overall
  const queues = metrics?.queues || {}
  const performance = metrics?.performance || {}
  const workers = metrics?.uptime?.workers || []
  const appUptime = metrics?.uptime?.app

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>System Health</h1>
          <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
            Uptime · performance · success rates · queues
          </p>
        </div>
        <button
          type="button"
          onClick={function () { setLoading(true); load() }}
          style={{
            padding: '8px 12px',
            backgroundColor: adminTheme.surfaceRaised,
            color: adminTheme.text,
            border: '1px solid ' + adminTheme.border,
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: adminTheme.fontMono,
          }}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div style={{
          ...adminPanelStyle(),
          padding: '12px 16px',
          marginBottom: '16px',
          borderColor: '#ef4444',
          color: '#fca5a5',
          fontSize: '13px',
        }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div style={adminStatCardStyle(healthColor)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>STATUS</p>
          <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase' }}>
            {health?.status || 'unknown'}
          </p>
        </div>
        <div style={adminStatCardStyle('#3b82f6')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>SUCCESS (30D)</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>
            {overall?.percent == null ? '—' : overall.percent + '%'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
            {overall ? (overall.success + '/' + overall.total) : ''}
          </p>
        </div>
        <div style={adminStatCardStyle('#f59e0b')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>QUEUE / RUNNING</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>
            {(queues.queued ?? 0) + ' / ' + (queues.running ?? 0)}
          </p>
        </div>
        <div style={adminStatCardStyle('#ef4444')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>FAILED (24H)</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{queues.failed_last_24h ?? 0}</p>
        </div>
      </div>

      {/* 6A — Uptime */}
      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Uptime tracking
          </h2>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {workers.map(function (w) {
            return (
              <div key={w.worker_name} style={adminStatCardStyle(colorForUptime(w.color))}>
                <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, textTransform: 'uppercase' }}>
                  {w.worker_name}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700, color: colorForUptime(w.color) }}>
                  {formatPct(w.percent)}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim }}>
                  {w.fresh ? 'Fresh' : 'Stale'} · {w.poll_count || 0}/{w.expected || 0} polls
                </p>
              </div>
            )
          })}
          <div style={adminStatCardStyle(colorForUptime(appUptime?.color))}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>NEXT.JS APP</p>
            <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700, color: colorForUptime(appUptime?.color) }}>
              {formatPct(appUptime?.percent)}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim }}>
              {appUptime?.source === 'platform_metrics' ? 'From daily metrics' : 'Estimated'}
            </p>
          </div>
        </div>
        <p style={{ margin: '0 18px 14px', fontSize: '11px', color: adminTheme.textDim }}>
          Green &gt; 99% · Yellow 95–99% · Red &lt; 95%
        </p>
      </div>

      {/* 6B — Performance */}
      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Performance metrics (30 days)
          </h2>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div style={adminStatCardStyle('#3b82f6')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>AVG PERMIT COMPLETION</p>
            <p style={{ margin: '6px 0 0', fontSize: '18px', fontWeight: 700 }}>
              {formatMinutes(performance.avg_permit_completion_minutes)}
            </p>
          </div>
          <div style={adminStatCardStyle('#8b5cf6')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>AVG NOC GENERATION</p>
            <p style={{ margin: '6px 0 0', fontSize: '18px', fontWeight: 700 }}>
              {formatMinutes(performance.avg_noc_generation_minutes)}
            </p>
          </div>
          <div style={adminStatCardStyle('#06b6d4')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>AVG PROOF.COM</p>
            <p style={{ margin: '6px 0 0', fontSize: '18px', fontWeight: 700 }}>
              {formatMinutes(performance.avg_proof_minutes)}
            </p>
          </div>
          <div style={adminStatCardStyle('#10b981')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>AVG EPN RECORDING</p>
            <p style={{ margin: '6px 0 0', fontSize: '18px', fontWeight: 700 }}>
              {formatMinutes(performance.avg_erecord_minutes)}
            </p>
          </div>
        </div>
      </div>

      {/* 6C — Success rates */}
      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Automation success rates (last 30 days)
          </h2>
        </div>
        {(metrics?.success_rates?.rows || []).length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No finished runs in the last 30 days</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {(metrics.success_rates.rows || []).map(function (row) {
                return (
                  <tr key={row.key} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                    <td style={{ padding: '10px 18px', fontSize: '13px', color: adminTheme.text }}>{row.label}</td>
                    <td style={{
                      padding: '10px 18px',
                      fontSize: '13px',
                      fontFamily: adminTheme.fontMono,
                      fontWeight: 700,
                      color: row.warn ? '#f59e0b' : '#10b981',
                      textAlign: 'right',
                    }}>
                      {row.percent == null ? '—' : row.percent + '%' + (row.warn ? ' ⚠' : '')}
                    </td>
                    <td style={{
                      padding: '10px 18px',
                      fontSize: '12px',
                      color: adminTheme.textDim,
                      fontFamily: adminTheme.fontMono,
                      textAlign: 'right',
                      width: '120px',
                    }}>
                      {row.success}/{row.total}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ padding: '12px 18px', fontSize: '13px', fontWeight: 700, color: adminTheme.text }}>Overall</td>
                <td style={{
                  padding: '12px 18px',
                  fontSize: '14px',
                  fontFamily: adminTheme.fontMono,
                  fontWeight: 700,
                  color: adminTheme.text,
                  textAlign: 'right',
                }}>
                  {overall?.percent == null ? '—' : overall.percent + '%'}
                </td>
                <td style={{
                  padding: '12px 18px',
                  fontSize: '12px',
                  color: adminTheme.textDim,
                  fontFamily: adminTheme.fontMono,
                  textAlign: 'right',
                }}>
                  {overall ? (overall.success + '/' + overall.total) : ''}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* 6D — Queues */}
      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Queue lengths
          </h2>
        </div>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={adminStatCardStyle('#3b82f6')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>QUEUED BY TYPE</p>
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: adminTheme.text, fontFamily: adminTheme.fontMono, lineHeight: 1.7 }}>
              Permit: {queues.by_type?.permit ?? 0}<br />
              NOC / Proof / ePN: {queues.by_type?.noc_proof ?? 0}<br />
              Ops: {queues.by_type?.ops ?? 0}<br />
              Other: {queues.by_type?.other ?? 0}
            </p>
          </div>
          <div style={adminStatCardStyle('#f59e0b')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>CURRENTLY RUNNING</p>
            <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{queues.running ?? 0}</p>
          </div>
          <div style={adminStatCardStyle('#10b981')}>
            <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>JOBS SUBMITTED TODAY</p>
            <p style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700 }}>{queues.jobs_submitted_today ?? 0}</p>
          </div>
        </div>
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>
            Recent error logs
          </h2>
        </div>
        {failedRuns.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No recent errors</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {failedRuns.map(function (run) {
                return (
                  <tr key={run.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                    <td style={{ padding: '10px 14px', fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>
                      {run.run_type}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#ef4444' }}>
                      {run.error_message || 'error'}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '11px', color: adminTheme.textDim }}>
                      {run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}
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
