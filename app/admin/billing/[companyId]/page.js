'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import { adminTheme, adminPanelStyle, adminStatCardStyle } from '../../../../lib/ui/admin-theme'

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
    })
  } catch {
    return '—'
  }
}

function vendorLabel(vendor) {
  const map = {
    polk_county: 'Polk County',
    lee_county: 'Lee County',
    onenotary: 'OneNotary',
    epn: 'ePN recording',
    other: 'Other',
  }
  return map[vendor] || vendor || 'Vendor'
}

function paymentTypeLabel(type) {
  const map = {
    permit_fee: 'Permit fee',
    notarization: 'Notarization',
    recording_fee: 'Recording fee',
    surcharge: 'Surcharge',
    other: 'Other',
  }
  return map[type] || type || 'Fee'
}

function statusBadge(status) {
  const s = String(status || 'draft')
  const colors = {
    draft: { bg: adminTheme.badgeBg, text: adminTheme.badgeText },
    sent: { bg: 'rgba(59,130,246,0.2)', text: '#93c5fd' },
    paid: { bg: 'rgba(16,185,129,0.2)', text: adminTheme.success },
    overdue: { bg: 'rgba(239,68,68,0.2)', text: adminTheme.danger },
  }
  const c = colors[s] || colors.draft
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

export default function AdminCompanyBillingPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params?.companyId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  useEffect(function () {
    if (!companyId) return
    load()
  }, [companyId])

  async function load() {
    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!session?.access_token) {
        router.replace('/login')
        return
      }

      const res = await fetch('/api/admin/billing/' + companyId, {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Could not load company billing')
        setLoading(false)
        return
      }
      setData(body)
      setLoading(false)
    } catch (err) {
      setError(err.message || 'Failed to load company billing')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>
          Loading company billing…
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px 28px' }}>
        <button
          type="button"
          onClick={function () { router.push('/admin/billing') }}
          style={{
            marginBottom: '12px',
            background: 'none',
            border: 'none',
            color: adminTheme.accent,
            cursor: 'pointer',
            fontSize: '13px',
            padding: 0,
          }}
        >
          ← Billing
        </button>
        <p style={{ color: adminTheme.danger }}>{error}</p>
      </div>
    )
  }

  const accrual = data?.accrual || {}
  const jobs = accrual.jobs || []
  const invoices = data?.invoices || []
  const gate = data?.submissionGate || { allowed: true }
  const company = data?.company || {}

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      <button
        type="button"
        onClick={function () { router.push('/admin/billing') }}
        style={{
          marginBottom: '12px',
          background: 'none',
          border: 'none',
          color: adminTheme.accent,
          cursor: 'pointer',
          fontSize: '13px',
          padding: 0,
        }}
      >
        ← Billing
      </button>

      <div style={{ marginBottom: '18px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: adminTheme.text, margin: 0 }}>
            {company.name || 'Company'}
          </h1>
          <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0' }}>
            {data?.period?.label} · {company.subscriptionPlan || 'unpriced'}
            {company.dbaName ? ' · DBA ' + company.dbaName : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={function () { router.push('/admin/companies/' + companyId) }}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid ' + adminTheme.border,
            backgroundColor: adminTheme.surfaceRaised,
            color: adminTheme.text,
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Company profile
        </button>
      </div>

      {!gate.allowed ? (
        <div style={{
          ...adminPanelStyle(),
          padding: '12px 16px',
          marginBottom: '14px',
          borderLeft: '3px solid ' + adminTheme.danger,
        }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: adminTheme.danger }}>
            New submissions blocked
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: adminTheme.textMuted }}>
            {gate.reason}
          </p>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={adminStatCardStyle(adminTheme.accent)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Current period estimate
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: 700, color: adminTheme.text }}>
            {formatCents(accrual.totalCents)}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '11px', color: adminTheme.textMuted }}>
            Issued-permit fees only · not a finalized invoice
          </p>
        </div>
        <div style={adminStatCardStyle(adminTheme.success)}>
          <p style={{ margin: 0, fontSize: '10px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Issued permits
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: 700, color: adminTheme.text }}>
            {accrual.issuedJobCount || 0}
          </p>
        </div>
      </div>

      <div style={{ ...adminPanelStyle(), marginBottom: '16px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            This period — by permit
          </h2>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: adminTheme.textDim, fontSize: '13px' }}>
            No issued permits with billable fees this period
          </div>
        ) : (
          jobs.map(function (job, idx) {
            return (
              <div
                key={job.jobId}
                style={{
                  padding: '14px 18px',
                  borderBottom: idx < jobs.length - 1 ? '1px solid ' + adminTheme.border : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: adminTheme.text }}>
                      {job.propertyAddress || 'Property'}
                      {job.propertyCity ? ', ' + job.propertyCity : ''}
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: adminTheme.textDim }}>
                      {job.permitNumber ? 'Permit ' + job.permitNumber + ' · ' : ''}
                      Issued {formatDate(job.permitIssuedAt)}
                      {' · '}
                      <button
                        type="button"
                        onClick={function () { router.push('/admin/jobs/' + job.jobId) }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: adminTheme.accent,
                          cursor: 'pointer',
                          fontSize: '11px',
                          padding: 0,
                        }}
                      >
                        Open job
                      </button>
                    </p>
                  </div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: adminTheme.text }}>
                    {formatCents(job.totalCents)}
                  </p>
                </div>
                <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
                  {(job.payments || []).map(function (p) {
                    return (
                      <li
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '12px',
                          color: adminTheme.textMuted,
                          padding: '3px 0',
                        }}
                      >
                        <span>{vendorLabel(p.vendor)} · {paymentTypeLabel(p.paymentType)}</span>
                        <span style={{ color: adminTheme.text }}>{formatCents(p.amountCents)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })
        )}
      </div>

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Invoices
          </h2>
        </div>
        {invoices.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: adminTheme.textDim, fontSize: '13px' }}>
            No invoices yet for this company. Expected until Stripe invoicing is live.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                  {['Period', 'Total', 'Status', 'Due', 'Paid', 'Stripe'].map(function (h) {
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
                {invoices.map(function (inv, i) {
                  return (
                    <tr
                      key={inv.id}
                      style={{
                        borderBottom: i < invoices.length - 1 ? '1px solid ' + adminTheme.border : 'none',
                      }}
                    >
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: adminTheme.text }}>
                        {inv.billingPeriodLabel}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: 600, color: adminTheme.text }}>
                        {formatCents(inv.totalCents)}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{statusBadge(inv.status)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>
                        {formatDate(inv.dueDate)}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>
                        {inv.paidAt ? formatDate(inv.paidAt) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                        {inv.stripeInvoiceId || '—'}
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
