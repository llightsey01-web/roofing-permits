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
import MaterialsPreferenceEditor, {
  selectedToPayload,
} from '../components/MaterialsPreferenceEditor'

const TOTAL_STEPS = 5

const STEPS = [
  { n: 1, label: 'Company Info' },
  { n: 2, label: 'License' },
  { n: 3, label: 'Preferences' },
  { n: 4, label: 'Materials' },
  { n: 5, label: 'Password' },
]

function FieldLabel({ children, tip }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      fontWeight: '600',
      color: contractorTheme.textMuted,
      marginBottom: '6px',
    }}>
      <span>{children}</span>
      {tip ? (
        <span
          title={tip}
          aria-label={tip}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            border: '1px solid ' + contractorTheme.border,
            color: contractorTheme.textMuted,
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'help',
            flexShrink: 0,
          }}
        >
          ?
        </span>
      ) : null}
    </label>
  )
}

/** Map legacy 4-step resume values onto the new 5-step wizard. */
function mapResumeStep(raw) {
  const n = Number(raw) || 1
  // Old wizard: step 4 was password → now step 5
  if (n === 4) return 5
  if (n >= 5) return 5
  return Math.min(Math.max(n, 1), TOTAL_STEPS)
}

export default function ContractorOnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [done, setDone] = useState(false)
  const [adminNotes, setAdminNotes] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [materialSelection, setMaterialSelection] = useState({
    primary: [],
    underlayment: [],
    ventilation: [],
  })
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
  })

  useEffect(function () {
    loadCompany()
  }, [])

  useEffect(function () {
    if (!savedMessage) return undefined
    const t = setTimeout(function () { setSavedMessage('') }, 3500)
    return function () { clearTimeout(t) }
  }, [savedMessage])

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

      setStep(mapResumeStep(company.onboarding_step))

      const placeholderName = /\(Pending Setup\)\s*$/i.test(company.name || '')
      setForm(function (prev) {
        return {
          ...prev,
          name: placeholderName ? '' : (company.name || ''),
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
    if (current === 5) {
      if (newPassword.length < 8) return 'Password must be at least 8 characters'
      if (!/[0-9]/.test(newPassword)) return 'Password must include at least one number'
      if (!/[A-Z]/.test(newPassword)) return 'Password must include at least one uppercase letter'
      if (newPassword !== confirmPassword) return 'Passwords do not match'
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
    // step 4 materials saved separately via /api/contractor/materials

    const res = await fetch('/api/contractor/onboarding/save-step', {
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
    setSavedMessage(data.message || 'Your progress has been saved')
    return true
  }

  async function handleNext() {
    setError('')
    const validationError = validateStep(step)
    if (validationError) {
      setError(validationError)
      return
    }

    if (step === 4) {
      setSaving(true)
      const token = await getToken()
      if (!token) {
        setSaving(false)
        return
      }
      const materials = selectedToPayload(materialSelection)
      if (materials.length) {
        const matRes = await fetch('/api/contractor/materials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ replace: true, materials }),
        })
        const matData = await matRes.json()
        if (!matRes.ok) {
          setSaving(false)
          setError(matData.error || 'Failed to save materials')
          return
        }
      }
      const ok = await saveStep(4)
      setSaving(false)
      if (!ok) return
      setStep(5)
      return
    }

    if (step < TOTAL_STEPS) {
      setSaving(true)
      const ok = await saveStep(step)
      setSaving(false)
      if (!ok) return
      setStep(step + 1)
      return
    }

    setSaving(true)
    const token = await getToken()
    if (!token) {
      setSaving(false)
      return
    }

    const res = await fetch('/api/contractor/onboarding/set-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        password: newPassword,
        confirmPassword: confirmPassword,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Failed to set password')
      return
    }
    setDone(true)
  }

  async function handleSkipMaterials() {
    setError('')
    setSaving(true)
    const ok = await saveStep(4)
    setSaving(false)
    if (!ok) return
    setStep(5)
  }

  function passwordRequirement(met, label) {
    return (
      <li style={{
        color: met ? '#10b981' : contractorTheme.textMuted,
        fontSize: '13px',
        marginBottom: '4px',
      }}>
        {met ? '✓' : '○'} {label}
      </li>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: contractorTheme.textMuted }}>
        Loading setup wizard...
      </div>
    )
  }

  if (done) {
    const checklist = [
      'Company information saved',
      'License verified',
      'Review preferences set',
      'Preferred materials saved',
      'Password created',
    ]
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', padding: '0 20px' }}>
        <div style={{ ...contractorCardStyle(), padding: '36px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '32px' }}>🎉</p>
            <h1 style={{ margin: '0 0 8px', color: contractorTheme.text, fontSize: '24px' }}>
              Setup Complete!
            </h1>
            <p style={{ margin: 0, color: contractorTheme.textBody, lineHeight: 1.6, fontSize: '15px' }}>
              Your account is now under review.
              <br />
              We will contact you within 1 business day.
            </p>
          </div>

          <ul style={{ listStyle: 'none', margin: '0 0 28px', padding: 0 }}>
            {checklist.map(function (item) {
              return (
                <li
                  key={item}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: '1px solid ' + contractorTheme.border,
                    color: contractorTheme.textBody,
                    fontSize: '14px',
                  }}
                >
                  <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
                  {item}
                </li>
              )
            })}
          </ul>

          <div style={{
            backgroundColor: contractorTheme.accentSoft,
            border: '1px solid ' + contractorTheme.border,
            borderRadius: '10px',
            padding: '16px',
            marginBottom: '20px',
          }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, color: contractorTheme.text, fontSize: '14px' }}>
              What happens next:
            </p>
            <ol style={{ margin: 0, paddingLeft: '20px', color: contractorTheme.textBody, fontSize: '14px', lineHeight: 1.7 }}>
              <li>Our team reviews your information</li>
              <li>You receive an approval email</li>
              <li>Add county portal credentials in Settings, then start submitting permits</li>
            </ol>
          </div>

          <p style={{ margin: 0, textAlign: 'center', fontSize: '14px', color: contractorTheme.textMuted }}>
            Questions? Email{' '}
            <a href="mailto:logan@dartiq.dev" style={{ color: '#3b82f6' }}>logan@dartiq.dev</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '720px', margin: '24px auto', padding: '0 20px 48px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '24px', color: contractorTheme.text }}>
          Account setup
        </h1>
        <p style={{ margin: 0, color: contractorTheme.textMuted, fontSize: '14px' }}>
          Step {step} of {TOTAL_STEPS}
        </p>
      </div>

      <div style={{
        height: '8px',
        backgroundColor: contractorTheme.border,
        borderRadius: '999px',
        overflow: 'hidden',
        marginBottom: '16px',
      }}>
        <div style={{
          width: (step / TOTAL_STEPS) * 100 + '%',
          height: '100%',
          backgroundColor: '#f97316',
          transition: 'width 0.2s ease',
        }} />
      </div>

      <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        marginBottom: '20px',
      }}>
        {STEPS.map(function (s) {
          const completed = s.n < step
          const current = s.n === step
          return (
            <div
              key={s.n}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '999px',
                border: '1px solid ' + (current ? '#f97316' : contractorTheme.border),
                backgroundColor: current
                  ? 'rgba(249, 115, 22, 0.12)'
                  : completed
                    ? 'rgba(16, 185, 129, 0.1)'
                    : 'transparent',
                fontSize: '12px',
                fontWeight: current ? 700 : 500,
                color: current
                  ? '#f97316'
                  : completed
                    ? '#10b981'
                    : contractorTheme.textMuted,
              }}
            >
              <span aria-hidden="true">{completed ? '✓' : s.n}</span>
              <span>{s.label}</span>
            </div>
          )
        })}
      </div>

      {savedMessage ? (
        <div style={{
          padding: '10px 14px',
          marginBottom: '14px',
          borderRadius: '10px',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.35)',
          color: '#10b981',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          {savedMessage}
        </div>
      ) : null}

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
                <FieldLabel>Company legal name *</FieldLabel>
                <input style={contractorInputStyle()} value={form.name} onChange={function (e) { setField('name', e.target.value) }} />
              </div>
              <div>
                <FieldLabel>DBA name</FieldLabel>
                <input style={contractorInputStyle()} value={form.dba_name} onChange={function (e) { setField('dba_name', e.target.value) }} />
              </div>
              <div>
                <FieldLabel>Address *</FieldLabel>
                <input style={contractorInputStyle()} value={form.address} onChange={function (e) { setField('address', e.target.value) }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px', gap: '10px' }}>
                <div>
                  <FieldLabel>City *</FieldLabel>
                  <input style={contractorInputStyle()} value={form.city} onChange={function (e) { setField('city', e.target.value) }} />
                </div>
                <div>
                  <FieldLabel>State</FieldLabel>
                  <input style={contractorInputStyle()} value={form.state} onChange={function (e) { setField('state', e.target.value) }} />
                </div>
                <div>
                  <FieldLabel>Zip *</FieldLabel>
                  <input style={contractorInputStyle()} value={form.zip} onChange={function (e) { setField('zip', e.target.value) }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <FieldLabel>Phone *</FieldLabel>
                  <input style={contractorInputStyle()} value={form.phone} onChange={function (e) { setField('phone', e.target.value) }} />
                </div>
                <div>
                  <FieldLabel>Primary email *</FieldLabel>
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
                <FieldLabel tip="Your Florida contractor license number (e.g. CCC1234567)">
                  Contractor license number *
                </FieldLabel>
                <input
                  style={contractorInputStyle()}
                  value={form.license_number}
                  onChange={function (e) { setField('license_number', e.target.value) }}
                  placeholder="CCC1234567"
                />
              </div>
              <div>
                <FieldLabel tip="The licensed qualifier on your contractor license">
                  Qualifier full name *
                </FieldLabel>
                <input
                  style={contractorInputStyle()}
                  value={form.qualifier_name}
                  onChange={function (e) { setField('qualifier_name', e.target.value) }}
                />
              </div>
              <div>
                <FieldLabel tip="License number for the qualifier listed on your contractor license">
                  Qualifier license number *
                </FieldLabel>
                <input
                  style={contractorInputStyle()}
                  value={form.qualifier_license}
                  onChange={function (e) { setField('qualifier_license', e.target.value) }}
                />
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
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: contractorTheme.text }}>
              Preferred Materials (Optional)
            </h2>
            <p style={{ margin: '0 0 16px', color: contractorTheme.textMuted, fontSize: '14px' }}>
              Select the materials you typically install. You can update these anytime in your portal.
            </p>
            <MaterialsPreferenceEditor
              getToken={getToken}
              initialSelected={materialSelection}
              onChange={setMaterialSelection}
              compact
            />
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: contractorTheme.text }}>
              Set Your Password
            </h2>
            <p style={{ margin: '0 0 16px', color: contractorTheme.textMuted, fontSize: '14px' }}>
              Create a secure password for your DART iQ account.
            </p>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <FieldLabel>Current temporary password</FieldLabel>
                <input
                  style={{
                    ...contractorInputStyle(),
                    color: contractorTheme.textMuted,
                  }}
                  value="DART-XXXXXXXX"
                  readOnly
                  aria-describedby="temp-password-hint"
                />
                <p id="temp-password-hint" style={{ margin: '6px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
                  Your temporary password was emailed when your account was created (format DART-XXXXXXXX).
                </p>
              </div>
              <div>
                <FieldLabel>New Password</FieldLabel>
                <input
                  style={contractorInputStyle()}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={function (e) { setNewPassword(e.target.value) }}
                />
              </div>
              <div>
                <FieldLabel>Confirm Password</FieldLabel>
                <input
                  style={contractorInputStyle()}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={function (e) { setConfirmPassword(e.target.value) }}
                />
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {passwordRequirement(newPassword.length >= 8, 'At least 8 characters')}
                {passwordRequirement(/[0-9]/.test(newPassword), 'At least one number')}
                {passwordRequirement(/[A-Z]/.test(newPassword), 'At least one uppercase letter')}
                {passwordRequirement(newPassword && newPassword === confirmPassword, 'Passwords match')}
              </ul>
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
          <div style={{ display: 'flex', gap: '10px' }}>
            {step === 4 ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleSkipMaterials}
                style={{
                  ...contractorPrimaryButtonStyle(saving),
                  backgroundColor: 'transparent',
                  color: contractorTheme.textMuted,
                  border: '1px solid ' + contractorTheme.border,
                  boxShadow: 'none',
                }}
              >
                Skip for now
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={handleNext}
              style={contractorPrimaryButtonStyle(saving)}
            >
              {saving
                ? 'Saving...'
                : step === 4
                  ? 'Save & Continue →'
                  : step === TOTAL_STEPS
                    ? 'Set Password & Complete Setup'
                    : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
