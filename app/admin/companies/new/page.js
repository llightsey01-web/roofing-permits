'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../../lib/ui/admin-theme'

const AHJ_OPTIONS = [
  { id: 'polk', label: 'Polk County', provider: 'polk_accela' },
  { id: 'lee', label: 'Lee County', provider: 'lee_accela' },
  { id: 'manatee', label: 'Manatee County', provider: 'manatee_accela' },
  { id: 'sarasota', label: 'Sarasota County', provider: 'sarasota_accela' },
]

const PLANS = [
  { value: 'starter', label: 'Starter — $750/mo' },
  { value: 'growth', label: 'Growth — $1,875/mo' },
  { value: 'scale', label: 'Scale — $3,750/mo' },
  { value: 'enterprise', label: 'Enterprise — Custom' },
]

const emptyForm = {
  name: '',
  dba_name: '',
  license_number: '',
  qualifier_name: '',
  qualifier_license: '',
  primary_email: '',
  phone: '',
  address: '',
  city: '',
  state: 'FL',
  zip: '',
  contact_first_name: '',
  contact_last_name: '',
  contact_email: '',
  contact_phone: '',
  subscription_plan: 'starter',
  trial_days: '30',
  notes: '',
  ahjs: { polk: true, lee: false, manatee: false, sarasota: false },
  review_gates: {
    noc_before_send: false,
    permit_before_submit: false,
    auto_approve_all: true,
  },
}

export default function OnboardContractorPage() {
  const router = useRouter()
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

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
    setForm(prev => ({ ...prev, [name]: value }))
  }

  function toggleAhj(id) {
    setForm(prev => ({ ...prev, ahjs: { ...prev.ahjs, [id]: !prev.ahjs[id] } }))
  }

  function setGate(key, checked) {
    setForm(prev => {
      const review_gates = { ...prev.review_gates, [key]: checked }
      if (key === 'auto_approve_all' && checked) {
        review_gates.noc_before_send = false
        review_gates.permit_before_submit = false
      }
      if ((key === 'noc_before_send' || key === 'permit_before_submit') && checked) {
        review_gates.auto_approve_all = false
      }
      return { ...prev, review_gates }
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

      const selectedAhjs = AHJ_OPTIONS.filter(a => form.ahjs[a.id]).map(a => ({
        id: a.id,
        label: a.label,
        provider: a.provider,
      }))

      const res = await fetch('/api/admin/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          company: {
            name: form.name,
            dba_name: form.dba_name || null,
            license_number: form.license_number,
            qualifier_name: form.qualifier_name,
            qualifier_license: form.qualifier_license,
            primary_email: form.primary_email,
            phone: form.phone,
            address: form.address || null,
            city: form.city || null,
            state: form.state || 'FL',
            zip: form.zip || null,
            subscription_plan: form.subscription_plan,
            trial_days: Number(form.trial_days) || 30,
            notes: form.notes || null,
            review_gates: form.review_gates,
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
    <div style={{ padding: '24px 28px', maxWidth: '860px' }}>
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => router.push('/admin/companies')}
          style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '12px', cursor: 'pointer', padding: 0, marginBottom: '8px', fontFamily: adminTheme.fontMono }}
        >
          ← Companies
        </button>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Onboard New Contractor</h1>
        <p style={{ fontSize: '13px', color: adminTheme.textDim, margin: '6px 0 0 0' }}>
          Creates company, portal admin user, AHJ placeholders, and sends welcome email
        </p>
      </div>

      {success && (
        <div style={{
          ...adminPanelStyle(), padding: '18px', marginBottom: '16px',
          borderColor: '#059669', backgroundColor: '#064e3b',
        }}>
          <p style={{ margin: 0, color: '#6ee7b7', fontWeight: '600' }}>Contractor onboarded successfully</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#a7f3d0', fontFamily: adminTheme.fontMono }}>
            Company ID: {success.company_id}
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#a7f3d0' }}>
            Login: <a href={success.login_url} style={{ color: '#93c5fd' }}>{success.login_url}</a>
          </p>
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              onClick={() => router.push('/admin/companies/' + success.company_id)}
              style={{ padding: '8px 12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
            >
              View company
            </button>
            <button
              onClick={() => setSuccess(null)}
              style={{ padding: '8px 12px', backgroundColor: 'transparent', color: '#a7f3d0', border: '1px solid #059669', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
            >
              Onboard another
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Company Information</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Company legal name *</label>
              <input style={inputStyle} required value={form.name} onChange={e => setField('name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>DBA name</label>
              <input style={inputStyle} value={form.dba_name} onChange={e => setField('dba_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>License number *</label>
              <input style={inputStyle} required value={form.license_number} onChange={e => setField('license_number', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Qualifier name *</label>
              <input style={inputStyle} required value={form.qualifier_name} onChange={e => setField('qualifier_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Qualifier license *</label>
              <input style={inputStyle} required value={form.qualifier_license} onChange={e => setField('qualifier_license', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Primary email *</label>
              <input style={inputStyle} type="email" required value={form.primary_email} onChange={e => setField('primary_email', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone *</label>
              <input style={inputStyle} required value={form.phone} onChange={e => setField('phone', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Address</label>
              <input style={inputStyle} value={form.address} onChange={e => setField('address', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} value={form.city} onChange={e => setField('city', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} value={form.state} onChange={e => setField('state', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Zip</label>
              <input style={inputStyle} value={form.zip} onChange={e => setField('zip', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Owner / Admin User</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle}>First name *</label>
              <input style={inputStyle} required value={form.contact_first_name} onChange={e => setField('contact_first_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Last name *</label>
              <input style={inputStyle} required value={form.contact_last_name} onChange={e => setField('contact_last_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Email * (login)</label>
              <input style={inputStyle} type="email" required value={form.contact_email} onChange={e => setField('contact_email', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={form.contact_phone} onChange={e => setField('contact_phone', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Subscription</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Plan</label>
              <select style={inputStyle} value={form.subscription_plan} onChange={e => setField('subscription_plan', e.target.value)}>
                {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Trial period (days)</label>
              <input style={inputStyle} type="number" min="0" value={form.trial_days} onChange={e => setField('trial_days', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notes</label>
              <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>AHJ Access</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {AHJ_OPTIONS.map(ahj => (
              <label key={ahj.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: adminTheme.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.ahjs[ahj.id]} onChange={() => toggleAhj(ahj.id)} />
                {ahj.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ ...adminPanelStyle(), padding: '20px', marginBottom: '16px' }}>
          <h2 style={sectionTitle}>Review Gates</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: adminTheme.text }}>
              <input type="checkbox" checked={form.review_gates.noc_before_send} onChange={e => setGate('noc_before_send', e.target.checked)} />
              Require NOC approval before sending
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: adminTheme.text }}>
              <input type="checkbox" checked={form.review_gates.permit_before_submit} onChange={e => setGate('permit_before_submit', e.target.checked)} />
              Require permit approval before submitting
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: adminTheme.text }}>
              <input type="checkbox" checked={form.review_gates.auto_approve_all} onChange={e => setGate('auto_approve_all', e.target.checked)} />
              Auto-approve all (default)
            </label>
          </div>
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', fontFamily: adminTheme.fontMono }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={() => router.push('/admin/companies')}
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
            {submitting ? 'Onboarding...' : 'Create Contractor Account'}
          </button>
        </div>
      </form>
    </div>
  )
}
