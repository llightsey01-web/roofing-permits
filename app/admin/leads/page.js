'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../lib/ui/admin-theme'

const STATUS_COLORS = {
  new: { bg: '#1e3a5f', text: '#93c5fd' },
  contacted: { bg: '#422006', text: '#fcd34d' },
  converted: { bg: '#064e3b', text: '#6ee7b7' },
  rejected: { bg: '#450a0a', text: '#fca5a5' },
}

export default function AdminLeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [message, setMessage] = useState('')

  async function load() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/leads' + (filter !== 'all' ? '?status=' + filter : ''), {
      headers: { Authorization: 'Bearer ' + session.access_token },
    })
    const payload = await res.json()
    if (res.ok) setLeads(payload.leads || [])
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
  }, [filter])

  async function updateStatus(leadId, status) {
    setMessage('')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/leads', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ id: leadId, status }),
    })
    const payload = await res.json()
    if (!res.ok) setMessage(payload.error || 'Update failed')
    else {
      setMessage('Lead updated')
      await load()
    }
  }

  if (loading) return <div style={{ padding: '48px', color: adminTheme.textMuted }}>Loading leads...</div>

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Leads</h1>
          <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>Early access requests from dartiq.dev</p>
        </div>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised, color: adminTheme.text }}
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {message && <p style={{ color: '#10b981', fontSize: '13px', marginBottom: '12px' }}>{message}</p>}

      <div style={adminPanelStyle()}>
        {leads.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: adminTheme.textDim }}>No leads found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                {['Name', 'Company', 'Email', 'Phone', 'Volume', 'Status', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, i) => {
                const st = STATUS_COLORS[lead.status || 'new'] || STATUS_COLORS.new
                return (
                  <tr key={lead.id} style={{ borderBottom: i < leads.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none' }}>
                    <td style={{ padding: '12px', fontSize: '13px', color: adminTheme.text, fontWeight: 600 }}>{lead.name}</td>
                    <td style={{ padding: '12px', fontSize: '12px', color: adminTheme.textMuted }}>{lead.company || '—'}</td>
                    <td style={{ padding: '12px', fontSize: '12px', color: adminTheme.textMuted }}>{lead.email}</td>
                    <td style={{ padding: '12px', fontSize: '12px', color: adminTheme.textMuted }}>{lead.phone || '—'}</td>
                    <td style={{ padding: '12px', fontSize: '12px', color: adminTheme.textMuted }}>{lead.monthly_volume || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: st.bg, color: st.text }}>
                        {(lead.status || 'new').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                      {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button onClick={() => updateStatus(lead.id, 'contacted')} style={smallBtn}>Contacted</button>
                        <button onClick={() => updateStatus(lead.id, 'rejected')} style={smallBtn}>Reject</button>
                        <button
                          onClick={() => router.push('/admin/companies/new')}
                          style={{ ...smallBtn, backgroundColor: '#3b82f6', color: 'white', border: 'none' }}
                        >
                          Convert
                        </button>
                      </div>
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

const smallBtn = {
  padding: '4px 8px',
  fontSize: '11px',
  borderRadius: '4px',
  border: '1px solid #334155',
  backgroundColor: '#1e293b',
  color: '#94a3b8',
  cursor: 'pointer',
}
