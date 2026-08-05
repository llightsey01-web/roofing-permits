'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../lib/ui/admin-theme'

function formatCents(cents) {
  const n = Number(cents) || 0
  return (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return '—'
  }
}

function statusBadge(status) {
  const s = String(status || '—')
  const colors = {
    draft: { bg: adminTheme.badgeBg, text: adminTheme.badgeText },
    sent: { bg: 'rgba(59,130,246,0.2)', text: '#93c5fd' },
    paid: { bg: 'rgba(16,185,129,0.2)', text: adminTheme.success },
    overdue: { bg: 'rgba(239,68,68,0.2)', text: adminTheme.danger },
  }
  const c = colors[s] || { bg: adminTheme.badgeBg, text: adminTheme.textDim }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      backgroundColor: c.bg,
      color: c.text,
      fontFamily: adminTheme.fontMono,
    }}>
      {s}
    </span>
  )
}

function shutoffFlag(row) {
  if (!row.submissionAllowed || row.shutoff?.shutoffBlocked) {
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '10px',
        fontWeight: 700,
        backgroundColor: 'rgba(239,68,68,0.2)',
        color: adminTheme.danger,
        fontFamily: adminTheme.fontMono,
      }}>
        SHUTOFF
      </span>
    )
  }
  if (row.shutoff?.shutoffApproaching) {
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '10px',
        fontWeight: 700,
        backgroundColor: 'rgba(245,158,11,0.2)',
        color: adminTheme.warning,
        fontFamily: adminTheme.fontMono,
      }}>
        APPROACHING
      </span>
    )
  }
  return (
    <span style={{ fontSize: '12px', color: adminTheme.textDim }}>—</span>
  )
}

function dueMeta(row) {
  const s = row.shutoff || {}
  if (s.daysPastDue != null) {
    return s.daysPastDue + 'd past due'
  }
  if (s.daysUntilDue != null) {
    return s.daysUntilDue === 0 ? 'due today' : s.daysUntilDue + 'd until due'
  }
  return '—'
}

export default function AdminBillingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(function () {
    load()
  }, [])

  async function load() {
    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!session?.access_token) {
        router.replace('/login')
        return
      }

      const res = await fetch('/api/admin/billing', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Could not load billing')
        setLoading(false)
        return
      }
      setData(body)
      setLoading(false)
    } catch (err) {
      setError(err.message || 'Failed to load billing')
      setLoading(false)
    }
  }

  const filtered = useMemo(function () {
    const rows = data?.companies || []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(function (r) {
      return [r.companyName, r.dbaName, r.subscriptionPlan]
        .filter(Boolean)
        .some(function (v) { return String(v).toLowerCase().includes(q) })
    })
  }, [data, search])

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>
          Loading billing…
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px 28px' }}>
        <p style={{ color: adminTheme.danger }}>{error}</p>
      </div>
    )
  }

  const aggregates = data?.aggregates || {}
  const shutoffDays = data?.shutoffDays || 15

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: adminTheme.text, margin: 0 }}>
          Billing
        </h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0' }}>
          {data?.period?.label} · read-only · Stripe fields display when webhooks populate them ·{' '}
          shutoff after {shutoffDays} days past due
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <div style={adminStatCardStyle(adminTheme.accent)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Accrued revenue (issued)
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '24px', fontWeight: 700, color: adminTheme.text }}>
            {formatCents(aggregates.accruedRevenueCents)}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: adminTheme.textMuted, lineHeight: 1.4 }}>
            {aggregates.accruedRevenueNote}
          </p>
        </div>
        <div style={adminStatCardStyle(adminTheme.warning)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            DART vendor cost
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '24px', fontWeight: 700, color: adminTheme.text }}>
            {formatCents(aggregates.dartVendorCostCents)}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: adminTheme.textMuted, lineHeight: 1.4 }}>
            {aggregates.dartVendorCostNote}
          </p>
        </div>
        <div style={adminStatCardStyle(adminTheme.success)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Companies
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '24px', fontWeight: 700, color: adminTheme.text }}>
            {aggregates.companyCount || 0}
          </p>
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <input
          value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search companies…"
          style={{
            width: '100%',
            maxWidth: '360px',
            padding: '8px 12px',
            border: '1px solid ' + adminTheme.border,
            borderRadius: '6px',
            fontSize: '13px',
            backgroundColor: adminTheme.surfaceRaised,
            color: adminTheme.text,
          }}
        />
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Companies ({filtered.length})
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: adminTheme.textDim, fontSize: '13px' }}>
            No companies match
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                  {['Company', 'Accrual', 'Vendor cost', 'Latest invoice', 'Due', 'Shutoff', 'Submit'].map(function (h) {
                    return (
                      <th
                        key={h}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: adminTheme.textDim,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontFamily: adminTheme.fontMono,
                        }}
                      >
                        {h}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (row, i) {
                  return (
                    <tr
                      key={row.companyId}
                      onClick={function () { router.push('/admin/billing/' + row.companyId) }}
                      style={{
                        borderBottom: i < filtered.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none',
                        cursor: 'pointer',
                        backgroundColor: row.shutoff?.shutoffBlocked || !row.submissionAllowed
                          ? 'rgba(239,68,68,0.06)'
                          : row.shutoff?.shutoffApproaching
                            ? 'rgba(245,158,11,0.06)'
                            : 'transparent',
                      }}
                      onMouseEnter={function (e) { e.currentTarget.style.backgroundColor = adminTheme.surfaceRaised }}
                      onMouseLeave={function (e) {
                        e.currentTarget.style.backgroundColor = row.shutoff?.shutoffBlocked || !row.submissionAllowed
                          ? 'rgba(239,68,68,0.06)'
                          : row.shutoff?.shutoffApproaching
                            ? 'rgba(245,158,11,0.06)'
                            : 'transparent'
                      }}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: adminTheme.text }}>
                          {row.companyName}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: adminTheme.textDim }}>
                          {row.subscriptionPlan || 'unpriced'}
                        </p>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: 600, color: adminTheme.text }}>
                        {formatCents(row.currentPeriodAccrualCents)}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: adminTheme.textMuted }}>
                        {formatCents(row.currentPeriodVendorCostCents)}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {row.latestInvoice ? (
                          <div>
                            {statusBadge(row.latestInvoice.status)}
                            <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim }}>
                              {formatCents(row.latestInvoice.totalCents)}
                              {row.latestInvoice.stripeInvoiceId
                                ? ' · ' + row.latestInvoice.stripeInvoiceId
                                : ''}
                            </p>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: adminTheme.textDim }}>No invoices</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono }}>
                        {row.latestInvoice ? (
                          <div>
                            <div>{formatDate(row.latestInvoice.dueDate)}</div>
                            <div style={{ marginTop: '2px', color: adminTheme.textDim }}>{dueMeta(row)}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{shutoffFlag(row)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', fontFamily: adminTheme.fontMono, color: row.submissionAllowed ? adminTheme.success : adminTheme.danger }}>
                        {row.submissionAllowed ? 'OK' : 'BLOCKED'}
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
