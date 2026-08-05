'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, safeGetUser, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import {
  contractorTheme,
  contractorCardStyle,
  contractorStatCardStyle,
} from '../../../lib/ui/contractor-theme'

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
    draft: { bg: contractorTheme.badgeBg, text: contractorTheme.badgeText },
    sent: { bg: 'rgba(59,130,246,0.15)', text: '#93c5fd' },
    paid: { bg: contractorTheme.successSoft, text: contractorTheme.success },
    overdue: { bg: contractorTheme.errorSoft, text: contractorTheme.error },
  }
  const c = colors[s] || colors.draft
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      backgroundColor: c.bg,
      color: c.text,
    }}>
      {s}
    </span>
  )
}

export default function ContractorBillingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  useEffect(function () {
    load()
  }, [])

  async function load() {
    try {
      const supabase = createClient()
      const { user, staleSession } = await safeGetUser(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!user) { router.replace('/login'); return }

      const { session } = await safeGetSession(supabase)
      const token = session?.access_token
      if (!token) { router.replace('/login'); return }

      const res = await fetch('/api/contractor/billing', {
        headers: { Authorization: 'Bearer ' + token },
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

  if (loading) {
    return (
      <div className="contractor-page" style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>Loading billing…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="contractor-page" style={{ padding: '28px' }}>
        <div style={{ ...contractorCardStyle(), padding: '20px', color: contractorTheme.error }}>
          {error}
        </div>
      </div>
    )
  }

  const accrual = data?.accrual || {}
  const jobs = accrual.jobs || []
  const invoices = data?.invoices || []
  const gate = data?.submissionGate || { allowed: true }

  return (
    <div className="contractor-page" style={{ padding: '28px', maxWidth: '960px' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: contractorTheme.text, margin: 0 }}>
          Billing
        </h1>
        <p style={{ fontSize: '14px', color: contractorTheme.textMuted, margin: '8px 0 0' }}>
          Permit fees for {data?.period?.label || 'this period'} · invoices when Stripe closes the period
        </p>
      </div>

      {!gate.allowed ? (
        <div style={{
          ...contractorCardStyle(),
          padding: '14px 18px',
          marginBottom: '18px',
          borderLeft: '4px solid ' + contractorTheme.error,
          backgroundColor: contractorTheme.errorSoft,
        }}>
          <p style={{ margin: 0, fontWeight: 600, color: contractorTheme.error, fontSize: '14px' }}>
            New permit submissions are blocked
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: contractorTheme.textBody }}>
            {gate.reason}
          </p>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '22px' }}>
        <div style={contractorStatCardStyle(contractorTheme.accent)}>
          <p style={{ margin: 0, fontSize: '12px', color: contractorTheme.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Current period estimate
          </p>
          <p style={{ margin: '10px 0 0', fontSize: '28px', fontWeight: 700, color: contractorTheme.text }}>
            {formatCents(accrual.totalCents)}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: contractorTheme.textMuted, lineHeight: 1.45 }}>
            Running total — not a finalized invoice. Based on permits issued this month with confirmed county/vendor fees.
          </p>
        </div>
        <div style={contractorStatCardStyle(contractorTheme.success)}>
          <p style={{ margin: 0, fontSize: '12px', color: contractorTheme.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Issued permits
          </p>
          <p style={{ margin: '10px 0 0', fontSize: '28px', fontWeight: 700, color: contractorTheme.text }}>
            {accrual.issuedJobCount || 0}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
            {accrual.paymentCount || 0} confirmed fee line{(accrual.paymentCount || 0) === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div style={{ ...contractorCardStyle(), marginBottom: '22px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + contractorTheme.border }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: contractorTheme.text }}>
            This period — by permit
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
            Only county-issued permits contribute. Fees paid by DART before issuance appear here once the permit is marked issued.
          </p>
        </div>
        {jobs.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: contractorTheme.textMuted, fontSize: '14px' }}>
            No issued permits with billable fees in {data?.period?.label || 'this period'} yet.
          </div>
        ) : (
          <div>
            {jobs.map(function (job) {
              return (
                <div
                  key={job.jobId}
                  style={{
                    padding: '16px 18px',
                    borderBottom: '1px solid ' + contractorTheme.border,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, color: contractorTheme.text, fontSize: '14px' }}>
                        {job.propertyAddress || 'Property'}
                        {job.propertyCity ? ', ' + job.propertyCity : ''}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
                        {job.permitNumber ? 'Permit ' + job.permitNumber + ' · ' : ''}
                        Issued {formatDate(job.permitIssuedAt)}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, color: contractorTheme.text, fontSize: '15px' }}>
                      {formatCents(job.totalCents)}
                    </p>
                  </div>
                  {(job.payments || []).length === 0 ? (
                    <p style={{ margin: '10px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
                      No confirmed vendor fees on this permit yet.
                    </p>
                  ) : (
                    <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                      {job.payments.map(function (p) {
                        return (
                          <li
                            key={p.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: '10px',
                              fontSize: '13px',
                              color: contractorTheme.textBody,
                              padding: '4px 0',
                            }}
                          >
                            <span>
                              {vendorLabel(p.vendor)} · {paymentTypeLabel(p.paymentType)}
                            </span>
                            <span style={{ fontWeight: 600 }}>{formatCents(p.amountCents)}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ ...contractorCardStyle(), overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + contractorTheme.border }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: contractorTheme.text }}>
            Invoices
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
            Finalized invoices from Stripe. Status, Stripe invoice ID, and paid date update when payment webhooks land.
          </p>
        </div>
        {invoices.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: contractorTheme.text }}>
              No invoices yet
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: contractorTheme.textMuted, lineHeight: 1.5, maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
              When monthly invoicing goes live, your period totals will appear here with status, due date, and payment confirmation from Stripe.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + contractorTheme.border }}>
                  {['Period', 'Total', 'Status', 'Due', 'Paid', 'Stripe'].map(function (h) {
                    return (
                      <th
                        key={h}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: contractorTheme.textMuted,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
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
                        borderBottom: i < invoices.length - 1 ? '1px solid ' + contractorTheme.border : 'none',
                      }}
                    >
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: contractorTheme.text }}>
                        {inv.billingPeriodLabel}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: 600, color: contractorTheme.text }}>
                        {formatCents(inv.totalCents)}
                      </td>
                      <td style={{ padding: '12px 14px' }}>{statusBadge(inv.status)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: contractorTheme.textBody }}>
                        {formatDate(inv.dueDate)}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: contractorTheme.textBody }}>
                        {inv.paidAt ? formatDate(inv.paidAt) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: contractorTheme.textMuted, fontFamily: 'ui-monospace, monospace' }}>
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
