'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, safeGetUser, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import {
  contractorTheme,
  contractorCardStyle,
  contractorPrimaryButtonStyle,
  contractorInputStyle,
} from '../../../lib/ui/contractor-theme'

const AHJ_OPTIONS = [
  { id: 'polk', label: 'Polk County', provider: 'polk_accela' },
  { id: 'lee', label: 'Lee County', provider: 'lee_accela' },
  { id: 'manatee', label: 'Manatee County', provider: 'manatee_accela' },
  { id: 'sarasota', label: 'Sarasota County', provider: 'sarasota_accela' },
]

export default function ContractorOnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [adminNotes, setAdminNotes] = useState('')
  const [form, setForm] = useState({
    name: '',
    dba_name: '',
    address: '',
    city: '',
    state: 'FL',
    zip: '',
    phone: '',
    primary_email: '',
    license_number: '',
    qualifier_name: '',
    qualifier_license: '',
    review_gates: {
      auto_approve_all: true,
      noc_before_send: false,
      permit_before_submit: false,
    },
    selectedAhjs: { polk: false, lee: false, manatee: false, sarasota: false },
  })

  useEffect(function () {
    loadCompany()
  }, [])

  async function getToken() {
    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return null
    return session?.access_token || null
  }

  async function loadCompany() {
    try {
      const supabase = createClient()
      const { user, staleSession } = await safeGetUser(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!user) {
        router.replace('/login')
        return
      }

      const { data: userData } = await supabase
        .from('users')
        .select('company_id, role')
        .eq('id', user.id)
        .single()

      if (!userData?.company_id) {
        router.replace('/login')
        return
      }

      const { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('id', userData.company_id)
        .single()

      if (!company) {
        setError('Company not found')
        setLoading(false)
        return
      }

      if (company.onboarding_status === 'pending_review') {
        setDone(true)
        setLoading(false)
        return
      }

      if (company.onboarding_status === 'active' || company.onboarding_status === 'complete') {
        router.replace('/contractor/dashboard')
        return
      }

      if (company.onboarding_status === 'needs_changes' && company.notes) {
        setAdminNotes(company.notes)
      }

      setForm(function (prev) {
        return {
          ...prev,
          name: company.name || '',
          dba_name: company.dba_name || '',
          address: company.address || '',
          city: company.city || '',
          state: company.state || 'FL',
          zip: company.zip || '',
          phone: company.phone || '',
          primary_email: company.primary_email || '',
          license_number: company.license_number || '',
          qualifier_name: company.qualifier_name || company.qualifer_name || '',
          qualifier_license: company.qualifier_license || company.qualifer_license || '',
          review_gates: {
            auto_approve_all: company.review_gates?.auto_approve_all !== false,
            noc_before_send: !!company.review_gates?.noc_before_send,
            permit_before_submit: !!company.review_gates?.permit_before_submit,
          },
          selectedAhjs: {
            polk: (company.covered_counties || []).includes('polk'),
            lee: (company.covered_counties || []).includes('lee'),
            manatee: (company.covered_counties || []).includes('manatee'),
            sarasota: (company.covered_counties || []).includes('sarasota'),
          },
        }
      })
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  function setField(key, value) {
    setForm(function (prev) {
      return { ...prev, [key]: value }
    })
  }

  function setGate(key, checked) {
    setForm(function (prev) {
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

  function toggleAhj(id) {
    setForm(function (prev) {
      return {
        ...prev,
        selectedAhjs: { ...prev.selectedAhjs, [id]: !prev.selectedAhjs[id] },
      }
    })
  }

  function validateStep(current) {
    if (current === 1) {
      if (!form.name.trim()) return 'Company legal name is required'
      if (!form.phone.trim()) return 'Phone is required'
      if (!form.primary_email.trim()) return 'Primary email is required'
      if (!form.address.trim() || !form.city.trim() || !form.zip.trim()) {
        return 'Address, city, and zip are required'
      }
    }
    if (current === 2) {
      if (!form.license_number.trim()) return 'Contractor license number is required'
      if (!form.qualifier_name.trim()) return 'Qualifier full name is required'
      if (!form.qualifier_license.trim()) return 'Qualifier license number is required'
    }
    if (current === 4) {
      const selected = AHJ_OPTIONS.filter(function (a) {
        return form.selectedAhjs[a.id]
      })
      if (selected.length === 0) return 'Select at least one county'
    }
    return ''
  }

  async function saveStep(current) {
    const token = await getToken()
    if (!token) return false

    const payload = { step: current }
    if (current === 1) {
      Object.assign(payload, {
        name: form.name,
        dba_name: form.dba_name,
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        phone: form.phone,
        primary_email: form.primary_email,
      })
    }
    if (current === 2) {
      Object.assign(payload, {
        license_number: form.license_number,
        qualifier_name: form.qualifier_name,
        qualifier_license: form.qualifier_license,
      })
    }
    if (current === 3) {
      payload.review_gates = form.review_gates
    }
    if (current === 4) {
      payload.covered_counties = AHJ_OPTIONS.filter(function (a) {
        return form.selectedAhjs[a.id]
      }).map(function (a) {
        return a.id
      })
    }

    const res = await fetch('/api/contractor/onboarding/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save step')
      return false
    }
    return true
  }

  async function handleNext() {
    setError('')
    const validationError = validateStep(step)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    const ok = await saveStep(step)
    setSaving(false)
    if (!ok) return

    if (step < 4) {
      setStep(step + 1)
      return
    }

    setSaving(true)
    const token = await getToken()
    if (!token) {
      setSaving(false)
      return
    }
    const res = await fetch('/api/contractor/onboarding/complete', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Failed to complete onboarding')
      return
    }
    setDone(true)
  }

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: contractorTheme.textMuted,
    marginBottom: '6px',
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: contractorTheme.textMuted }}>
        Loading setup wizard...
      </div>
    )
  }

  if (done) {
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', padding: '0 20px' }}>
        <div style={{ ...contractorCardStyle(), padding: '36px', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 12px', color: contractorTheme.text, fontSize: '24px' }}>
            Account under review
          </h1>
          <p style={{ margin: 0, color: contractorTheme.textBody, lineHeight: 1.6, fontSize: '16px' }}>
            Your account is under review. We will notify you within 1 business day.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '720px', margin: '24px auto', padding: '0 20px 48px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '24px', color: contractorTheme.text }}>
          Account setup
        </h1>
        <p style={{ margin: 0, color: contractorTheme.textMuted, fontSize: '14px' }}>
          Step {step} of 4
        </p>
      </div>

      <div style={{
        height: '8px',
        backgroundColor: contractorTheme.border,
        borderRadius: '999px',
        overflow: 'hidden',
        marginBottom: '20px',
      }}>
        <div style={{
          width: (step / 4) * 100 + '%',
          height: '100%',
          backgroundColor: contractorTheme.accent,
          transition: 'width 0.2s ease',
        }} />
      </div>

      {adminNotes ? (
        <div style={{
          ...contractorCardStyle(),
          padding: '14px 16px',
          marginBottom: '16px',
          borderColor: '#f59e0b',
          backgroundColor: contractorTheme.warningSoft,
        }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: contractorTheme.warning }}>
            Changes requested
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '14px', color: contractorTheme.textBody }}>
            {adminNotes}
          </p>
        </div>
      ) : null}

      <div style={{ ...contractorCardStyle(), padding: '24px' }}>
        {step === 1 && (
          <div>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: contractorTheme.text }}>Company Info</h2>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Company legal name *</label>
                <input style={contractorInputStyle()} value={form.name} onChange={function (e) { setField('name', e.target.value) }} />
              </div>
              <div>
                <label style={labelStyle}>DBA name</label>
                <input style={contractorInputStyle()} value={form.dba_name} onChange={function (e) { setField('dba_name', e.target.value) }} />
              </div>
              <div>
                <label style={labelStyle}>Address *</label>
                <input style={contractorInputStyle()} value={form.address} onChange={function (e) { setField('address', e.target.value) }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>City *</label>
                  <input style={contractorInputStyle()} value={form.city} onChange={function (e) { setField('city', e.target.value) }} />
                </div>
                <div>
                  <label style={labelStyle}>State</label>
                  <input style={contractorInputStyle()} value={form.state} onChange={function (e) { setField('state', e.target.value) }} />
                </div>
                <div>
                  <label style={labelStyle}>Zip *</label>
                  <input style={contractorInputStyle()} value={form.zip} onChange={function (e) { setField('zip', e.target.value) }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Phone *</label>
                  <input style={contractorInputStyle()} value={form.phone} onChange={function (e) { setField('phone', e.target.value) }} />
                </div>
                <div>
                  <label style={labelStyle}>Primary email *</label>
                  <input style={contractorInputStyle()} type="email" value={form.primary_email} onChange={function (e) { setField('primary_email', e.target.value) }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: contractorTheme.text }}>License Info</h2>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Contractor license number *</label>
                <input style={contractorInputStyle()} value={form.license_number} onChange={function (e) { setField('license_number', e.target.value) }} />
              </div>
              <div>
                <label style={labelStyle}>Qualifier full name *</label>
                <input style={contractorInputStyle()} value={form.qualifier_name} onChange={function (e) { setField('qualifier_name', e.target.value) }} />
              </div>
              <div>
                <label style={labelStyle}>Qualifier license number *</label>
                <input style={contractorInputStyle()} value={form.qualifier_license} onChange={function (e) { setField('qualifier_license', e.target.value) }} />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: contractorTheme.text }}>Review Preferences</h2>
            <div style={{ display: 'grid', gap: '12px' }}>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'center', color: contractorTheme.textBody }}>
                <input type="checkbox" checked={form.review_gates.auto_approve_all} onChange={function (e) { setGate('auto_approve_all', e.target.checked) }} />
                Auto-approve all (default ON)
              </label>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'center', color: contractorTheme.textBody }}>
                <input type="checkbox" checked={form.review_gates.noc_before_send} onChange={function (e) { setGate('noc_before_send', e.target.checked) }} />
                Require my approval before NOC is sent
              </label>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'center', color: contractorTheme.textBody }}>
                <input type="checkbox" checked={form.review_gates.permit_before_submit} onChange={function (e) { setGate('permit_before_submit', e.target.checked) }} />
                Require my approval before permit is submitted
              </label>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: contractorTheme.text }}>AHJ Coverage</h2>
            <p style={{ margin: '0 0 6px', color: contractorTheme.text, fontSize: '14px', fontWeight: 600 }}>
              Which counties do you plan to submit permits in?
            </p>
            <p style={{ margin: '0 0 14px', color: contractorTheme.textMuted, fontSize: '13px' }}>
              You can add login credentials later when you&apos;re ready
            </p>
            <div style={{ display: 'grid', gap: '10px' }}>
              {AHJ_OPTIONS.map(function (ahj) {
                const selected = form.selectedAhjs[ahj.id]
                return (
                  <label
                    key={ahj.id}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      color: contractorTheme.text,
                      fontWeight: 600,
                      border: '1px solid ' + contractorTheme.border,
                      borderRadius: '10px',
                      padding: '14px',
                      cursor: 'pointer',
                      backgroundColor: selected ? contractorTheme.accentSoft : 'transparent',
                    }}
                  >
                    <input type="checkbox" checked={selected} onChange={function () { toggleAhj(ahj.id) }} />
                    {ahj.label}
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {error ? (
          <p style={{ color: contractorTheme.error, margin: '16px 0 0', fontSize: '14px' }}>{error}</p>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', gap: '10px' }}>
          <button
            type="button"
            disabled={step === 1 || saving}
            onClick={function () { setError(''); setStep(step - 1) }}
            style={{
              ...contractorPrimaryButtonStyle(step === 1 || saving),
              backgroundColor: 'transparent',
              color: contractorTheme.textMuted,
              border: '1px solid ' + contractorTheme.border,
              boxShadow: 'none',
            }}
          >
            Back
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleNext}
            style={contractorPrimaryButtonStyle(saving)}
          >
            {saving ? 'Saving...' : step === 4 ? 'Finish setup' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
