'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../../lib/ui/admin-theme'

const PLANS = [
  { value: 'starter', label: 'Starter — $750/mo' },
  { value: 'growth', label: 'Growth — $1,875/mo' },
  { value: 'scale', label: 'Scale — $3,750/mo' },
  { value: 'enterprise', label: 'Enterprise — Custom' },
]

const emptyForm = {
  contact_first_name: '',
  contact_last_name: '',
  contact_email: '',
  contact_phone: '',
  subscription_plan: 'starter',
  trial_days: '30',
  notes: '',
  ahjIds: {},
}

export default function OnboardContractorPage() {
  const router = useRouter()
  const [form, setForm] = useState(emptyForm)
  const [ahjPortals, setAhjPortals] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  useEffect(function () {
    async function loadAhjs() {
      const supabase = createClient()
      const { data } = await supabase
        .from('ahj_portals')
        .select('id, name, county_or_city, portal_url, credential_key')
        .eq('is_active', true)
        .order('name')
      setAhjPortals(data || [])
    }
    loadAhjs()
  }, [])

  const inputStyle = {
    width: '100%', padding: '9px 11px',
    border: '1px solid ' + adminTheme.border,
    borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box',
    backgroundColor: adminTheme.surfaceRaised, color: adminTheme.text,
  }
  const labelStyle = {
    display: 'block', fontSize: '11px', fontWeight: '600',
    marginBottom: '5px', color: adminTheme.textMuted,
    fontFamily: adminTheme.fontMono, textTransform: 'uppercase', letterSpacing: '0.06em',
  }
  const sectionTitle = {
    fontSize: '12px', fontWeight: '700', color: adminTheme.text,
    margin: '0 0 14px 0', fontFamily: adminTheme.fontMono, letterSpacing: '0.06em',
    textTransform: 'uppercase',
  }

  function setField(name, value) {
    setForm(function (prev) { return { ...prev, [name]: value } })
  }

  function toggleAhj(id) {
    setForm(function (prev) {
      return {
        ...prev,
        ahjIds: { ...prev.ahjIds, [id]: !prev.ahjIds[id] },
      }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess(null)

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expired — sign in again')

      const selectedAhjs = ahjPortals
        .filter(function (p) { return form.ahjIds[p.id] })
        .map(function (p) {
          return {
            id: p.id,
            label: p.name || p.county_or_city,
            portal_id: p.id,
            name: p.name,
            county_or_city: p.county_or_city,
            credential_key: p.credential_key,
          }
        })

      const res = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          company: {
            subscription_plan: form.subscription_plan,
            trial_days: Number(form.trial_days) || 30,
            notes: form.notes || null,
          },
          owner: {
            first_name: form.contact_first_name,
            last_name: form.contact_last_name,
            email: form.contact_email,
            phone: form.contact_phone || null,
          },
          ahjs: selectedAhjs,
        }),
      })

      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Onboarding failed')

      setSuccess(payload)
      setForm(emptyForm)
    } catch (err) {
      setError(err.message)
    }
    setSubmitting(false)
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '720px' }}>
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={function () { router.push('/admin/companies') }}
          style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', padding: 0, marginBottom: '8px', fontFamily: adminTheme.fontMono }}
        >
          ← Companies
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>
          Onboard New Contractor
        </h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
          Creates a login, sends a welcome email, and lets the contractor complete company details
        </p>
      </div>

      {success ? (
        <div style={{
          ...adminPanelStyle(), padding: '18px', marginBottom: '16px',
          borderColor: '#059669', backgroundColor: '#064e3b',
        }}>
          <p style={{ margin: 0, color: '#6ee7b7', fontWeight: '600' }}>Contractor invite sent</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#a7f3d0', fontFamily: adminTheme.fontMono }}>
            Company ID: {success.company_id}
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#a7f3d0' }}>
            Login: <a href={success.login_url} style={{ color: '#93c5fd' }}>{success.login_url}</a>
          </p>
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              onClick={function () { router.push('/admin/companies/' + success.company_id) }}
              style={{ padding: '8px 12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
            >
              View company
            </button>
            <button
              onClick={function () { setSuccess(null) }}
              style={{ padding: '8px 12px', backgroundColor: 'transparent', color: '#a7f3d0', border: '1px solid #059669', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
            >
              Onboard another
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Owner / Admin User</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle}>First name *</label>
              <input
                style={inputStyle}
                required
                value={form.contact_first_name}
                onChange={function (e) { setField('contact_first_name', e.target.value) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Last name *</label>
              <input
                style={inputStyle}
                required
                value={form.contact_last_name}
                onChange={function (e) { setField('contact_last_name', e.target.value) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Email * (login)</label>
              <input
                style={inputStyle}
                type="email"
                required
                value={form.contact_email}
                onChange={function (e) { setField('contact_email', e.target.value) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                style={inputStyle}
                value={form.contact_phone}
                onChange={function (e) { setField('contact_phone', e.target.value) }}
              />
            </div>
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Subscription</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Plan</label>
              <select
                style={inputStyle}
                value={form.subscription_plan}
                onChange={function (e) { setField('subscription_plan', e.target.value) }}
              >
                {PLANS.map(function (p) {
                  return <option key={p.value} value={p.value}>{p.label}</option>
                })}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Trial period (days)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={form.trial_days}
                onChange={function (e) { setField('trial_days', e.target.value) }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notes (internal only)</label>
              <textarea
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                value={form.notes}
                onChange={function (e) { setField('notes', e.target.value) }}
              />
            </div>
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>AHJ Access</h2>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: adminTheme.textDim }}>
            Which counties will this contractor work in?
          </p>
          {ahjPortals.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: adminTheme.textMuted }}>
              No active AHJs found in ahj_portals.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {ahjPortals.map(function (ahj) {
                return (
                  <label
                    key={ahj.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: adminTheme.text,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!form.ahjIds[ahj.id]}
                      onChange={function () { toggleAhj(ahj.id) }}
                    />
                    {ahj.name || ahj.county_or_city}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {error ? (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', fontFamily: adminTheme.fontMono }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={function () { router.push('/admin/companies') }}
            style={{
              padding: '10px 16px', border: '1px solid ' + adminTheme.border, borderRadius: '6px',
              backgroundColor: adminTheme.surface, color: adminTheme.textMuted, cursor: 'pointer', fontSize: '13px',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '10px 16px', backgroundColor: submitting ? adminTheme.textDim : '#3b82f6',
              color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Sending invite...' : 'Create Contractor Account'}
          </button>
        </div>
      </form>
    </div>
  )
}
