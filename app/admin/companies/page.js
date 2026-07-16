'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../lib/ui/admin-theme'

export default function AdminCompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState([])
  const [jobCounts, setJobCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: companyRows } = await supabase
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false })

      const { data: jobs } = await supabase.from('jobs').select('company_id')
      const counts = {}
      ;(jobs || []).forEach(j => {
        if (!j.company_id) return
        counts[j.company_id] = (counts[j.company_id] || 0) + 1
      })

      setCompanies(companyRows || [])
      setJobCounts(counts)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return companies.filter(c => {
      if (statusFilter === 'active' && c.is_active === false) return false
      if (statusFilter === 'inactive' && c.is_active !== false) return false
      if (statusFilter === 'trial' && c.subscription_status !== 'trial') return false
      if (!q) return true
      return [c.name, c.dba_name, c.primary_email, c.phone, c.license_number, c.qualifier_name]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    })
  }, [companies, search, statusFilter])

  const inputStyle = {
    padding: '8px 12px',
    border: '1px solid ' + adminTheme.border,
    borderRadius: '6px',
    fontSize: '13px',
    backgroundColor: adminTheme.surfaceRaised,
    color: adminTheme.text,
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>Loading companies...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Companies</h1>
          <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
            All contractor tenants on the platform
          </p>
        </div>
        <button
          onClick={() => router.push('/admin/companies/new')}
          style={{
            padding: '10px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}
        >
          + Onboard New Contractor
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="Search company, email, license..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={inputStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="trial">Trial</option>
        </select>
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised }}>
          <h2 style={{ fontSize: '11px', fontWeight: '600', color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Companies ({filtered.length})
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: adminTheme.textDim, fontSize: '13px' }}>
            No companies match your filters
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                {['Company', 'Owner / Contact', 'Plan', 'Status', 'Jobs', 'Created'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '600',
                    color: adminTheme.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: adminTheme.fontMono,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((company, i) => (
                <tr
                  key={company.id}
                  onClick={() => router.push('/admin/companies/' + company.id)}
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = adminTheme.surfaceRaised }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <td style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: adminTheme.text, margin: 0 }}>{company.name}</p>
                    <p style={{ fontSize: '11px', color: adminTheme.textDim, margin: '2px 0 0 0' }}>
                      {company.city ? company.city + ', ' + (company.state || 'FL') : company.primary_email || '—'}
                    </p>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '12px', color: adminTheme.text, margin: 0 }}>{company.qualifier_name || '—'}</p>
                    <p style={{ fontSize: '11px', color: adminTheme.textDim, margin: '2px 0 0 0' }}>{company.primary_email || company.phone || '—'}</p>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted, textTransform: 'capitalize', fontFamily: adminTheme.fontMono }}>
                    {company.subscription_plan || 'starter'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', fontFamily: adminTheme.fontMono,
                      backgroundColor: company.is_active === false ? '#450a0a' : '#064e3b',
                      color: company.is_active === false ? '#fca5a5' : '#6ee7b7',
                    }}>
                      {company.is_active === false ? 'INACTIVE' : (company.subscription_status || 'ACTIVE').toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: adminTheme.text, fontFamily: adminTheme.fontMono }}>
                    {jobCounts[company.id] || 0}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                    {company.created_at ? new Date(company.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
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
