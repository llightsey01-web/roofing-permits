'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../lib/ui/admin-theme'

export default function AdminSystemPage() {
  const [health, setHealth] = useState(null)
  const [heartbeats, setHeartbeats] = useState([])
  const [failedRuns, setFailedRuns] = useState([])
  const [successRate, setSuccessRate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      try {
        const healthRes = await fetch('/api/internal/health')
        setHealth(await healthRes.json())
      } catch {
        setHealth({ status: 'down' })
      }

      const [{ data: hb }, { data: failed }, { data: recent }] = await Promise.all([
        supabase.from('worker_heartbeats').select('*').order('last_poll_at', { ascending: false }),
        supabase.from('automation_runs').select('id, job_id, run_type, error_message, completed_at, run_status').eq('run_status', 'error').order('completed_at', { ascending: false }).limit(25),
        supabase.from('automation_runs').select('run_status').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(500),
      ])

      setHeartbeats(hb || [])
      setFailedRuns(failed || [])

      const rows = recent || []
      if (rows.length) {
        const ok = rows.filter(r => r.run_status === 'complete' || r.run_status === 'needs_review').length
        setSuccessRate(Math.round((ok / rows.length) * 100))
      } else {
        setSuccessRate(null)
      }

      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div style={{ padding: '48px', color: adminTheme.textMuted }}>Loading system health...</div>

  const healthColor = health?.status === 'ok' || health?.status === 'healthy'
    ? '#10b981'
    : health?.status === 'degraded'
      ? '#f59e0b'
      : '#ef4444'

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>System Health</h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
          Workers · automation success · recent errors
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div style={adminStatCardStyle(healthColor)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>STATUS</p>
          <p style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase' }}>{health?.status || 'unknown'}</p>
        </div>
        <div style={adminStatCardStyle('#3b82f6')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>SUCCESS (24H)</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{successRate == null ? '—' : successRate + '%'}</p>
        </div>
        <div style={adminStatCardStyle('#f59e0b')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>STUCK JOBS</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{health?.stuckJobs ?? 0}</p>
        </div>
        <div style={adminStatCardStyle('#ef4444')}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim }}>FAILED (1H)</p>
          <p style={{ margin: '4px 0 0', fontSize: '22px', fontWeight: 700 }}>{health?.failedRunsLastHour ?? 0}</p>
        </div>
      </div>

      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>Worker heartbeats</h2>
        </div>
        {heartbeats.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No heartbeat records</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {heartbeats.map(hb => {
                const up = health?.workers?.[hb.worker_name]
                return (
                  <tr key={hb.worker_name} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                    <td style={{ padding: '12px 18px', fontSize: '13px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>{hb.worker_name}</td>
                    <td style={{ padding: '12px 18px', fontSize: '12px', color: up ? '#10b981' : '#ef4444' }}>{up ? 'UP' : 'STALE'}</td>
                    <td style={{ padding: '12px 18px', fontSize: '12px', color: adminTheme.textMuted }}>
                      {hb.last_poll_at ? new Date(hb.last_poll_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border }}>
          <h2 style={{ fontSize: '12px', margin: 0, color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>Recent error logs</h2>
        </div>
        {failedRuns.length === 0 ? (
          <div style={{ padding: '20px', color: adminTheme.textDim }}>No recent errors</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {failedRuns.map(run => (
                <tr key={run.id} style={{ borderBottom: '1px solid ' + adminTheme.borderSubtle }}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', fontFamily: adminTheme.fontMono, color: adminTheme.text }}>{run.run_type}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: '#ef4444' }}>{run.error_message || 'error'}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: adminTheme.textDim }}>
                    {run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
