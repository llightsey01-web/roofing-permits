'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, safeGetUser, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import { contractorTheme, contractorCardStyle, contractorPrimaryButtonStyle } from '../../../lib/ui/contractor-theme'

export default function ContractorSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '', address: '', city: '', state: 'FL', zip: '',
    phone: '', primary_email: '', license_number: '',
    qualifer_name: '', qualifer_license: '',
  })

  const [credentials, setCredentials] = useState([])
  const [vaultCredentials, setVaultCredentials] = useState([])
  const [ahjs, setAhjs] = useState([])
  const [coveredCounties, setCoveredCounties] = useState([])
  const [encryptionConfigured, setEncryptionConfigured] = useState(true)
  const [credModal, setCredModal] = useState(null) // { countyId, label, ahjId, hasCreds }
  const [credForm, setCredForm] = useState({ username: '', password: '' })
  const [credSaving, setCredSaving] = useState(false)
  const [credMessage, setCredMessage] = useState('')
  const [reviewGates, setReviewGates] = useState({
    noc_before_send: false,
    permit_before_submit: false,
    auto_approve_all: true,
  })
  const [reviewSaving, setReviewSaving] = useState(false)
  const [reviewSaved, setReviewSaved] = useState(false)
  const [reviewError, setReviewError] = useState('')

  const COUNTY_OPTIONS = [
    { id: 'polk', label: 'Polk County', provider: 'polk_accela' },
    { id: 'lee', label: 'Lee County', provider: 'lee_accela' },
    { id: 'manatee', label: 'Manatee County', provider: 'manatee_accela' },
    { id: 'sarasota', label: 'Sarasota County', provider: 'sarasota_accela' },
  ]

  useEffect(() => {
    loadAll()
  }, [])

  async function getToken() {
    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return null
    return session?.access_token
  }

  async function loadAll() {
    try {
      const supabase = createClient()
      const { user, staleSession } = await safeGetUser(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!user) { router.replace('/login'); return }

      const token = await getToken()
      if (!token) return
      const [companyRes, credRes, gatesRes, ahjRes] = await Promise.all([
        fetch('/api/contractor/company', { headers: { Authorization: 'Bearer ' + token } }),
        fetch('/api/contractor/credentials', { headers: { Authorization: 'Bearer ' + token } }),
        fetch('/api/contractor/company/review-gates', { headers: { Authorization: 'Bearer ' + token } }),
        supabase.from('ahj_portals').select('id, name, county_or_city').eq('is_active', true),
      ])

      const companyData = await companyRes.json()
      if (companyRes.ok && companyData.company) {
        const c = companyData.company
        setForm({
          name: c.name || '', address: c.address || '', city: c.city || '',
          state: c.state || 'FL', zip: c.zip || '', phone: c.phone || '',
          primary_email: c.primary_email || '', license_number: c.license_number || '',
          qualifer_name: c.qualifer_name || c.qualifier_name || '',
          qualifer_license: c.qualifer_license || c.qualifier_license || '',
        })
        setCoveredCounties(Array.isArray(c.covered_counties) ? c.covered_counties : [])
      }

      const credData = await credRes.json()
      if (credRes.ok) {
        setCredentials(credData.credentials || [])
        setVaultCredentials(credData.vaultCredentials || [])
        setEncryptionConfigured(credData.encryptionConfigured !== false)
      }

      const gatesData = await gatesRes.json()
      if (gatesRes.ok && gatesData.review_gates) {
        setReviewGates(gatesData.review_gates)
      }

      setAhjs(ahjRes.data || [])
      setLoading(false)
    } catch (err) {
      console.error('[auth] Contractor settings load failed:', err)
      router.replace('/login')
    }
  }

  async function handleSaveReviewGates(e) {
    e.preventDefault()
    setReviewSaving(true)
    setReviewError('')
    const token = await getToken()
    const response = await fetch('/api/contractor/company/review-gates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        noc_before_send: reviewGates.noc_before_send,
        permit_before_submit: reviewGates.permit_before_submit,
        auto_approve_all: !reviewGates.noc_before_send && !reviewGates.permit_before_submit,
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      setReviewError(result.error || 'Failed to save review preferences')
    } else {
      setReviewGates(result.review_gates)
      setReviewSaved(true)
      setTimeout(() => setReviewSaved(false), 3000)
    }
    setReviewSaving(false)
  }

  async function handleSaveCompany(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const token = await getToken()
    const response = await fetch('/api/contractor/company', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(form),
    })
    if (!response.ok) {
      const result = await response.json()
      setError(result.error || 'Failed to save')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  async function handleSaveCredentialModal(e) {
    e.preventDefault()
    if (!credModal) return
    setCredSaving(true)
    setCredMessage('')
    const token = await getToken()
    if (!credForm.username.trim() || !credForm.password) {
      setCredMessage('Username and password are required')
      setCredSaving(false)
      return
    }

    const response = await fetch('/api/contractor/credentials/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        county_id: credModal.countyId,
        ahj_id: credModal.ahjId || null,
        username: credForm.username.trim(),
        password: credForm.password,
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      setCredMessage(result.error || 'Failed to save credential')
    } else {
      setCredMessage('Credentials saved')
      setCredForm({ username: '', password: '' })
      setTimeout(function () {
        setCredModal(null)
        setCredMessage('')
      }, 700)
      await loadAll()
    }
    setCredSaving(false)
  }

  function openCredModal(county) {
    setCredModal(county)
    setCredForm({ username: '', password: '' })
    setCredMessage('')
  }

  function countyHasCredentials(countyId, ahjId, provider) {
    const vaultHit = vaultCredentials.some(function (c) {
      if (!c.is_active && c.is_active !== undefined) return false
      if (ahjId && c.ahj_id === ahjId && c.has_password) return true
      if (provider && c.provider === provider && c.has_password) return true
      return false
    })
    if (vaultHit) return true
    return credentials.some(function (c) {
      return ahjId && c.ahj_id === ahjId && c.has_password
    })
  }

  function findPortalForCounty(countyId) {
    return ahjs.find(function (a) {
      const hay = ((a.name || '') + ' ' + (a.county_or_city || '')).toLowerCase()
      return hay.includes(countyId)
    }) || null
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>Loading settings...</p>
      </div>
    )
  }

  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    fontSize: '14px',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
  }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: contractorTheme.text }
  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: contractorTheme.text,
    marginBottom: '20px',
    marginTop: 0,
    paddingBottom: '12px',
    borderBottom: '1px solid ' + contractorTheme.border,
  }
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }

  const coveredCountyRows = COUNTY_OPTIONS
    .filter(function (c) { return coveredCounties.includes(c.id) })
    .map(function (c) {
      const portal = findPortalForCounty(c.id)
      const hasCreds = countyHasCredentials(c.id, portal?.id || null, c.provider)
      return {
        countyId: c.id,
        label: c.label,
        provider: c.provider,
        ahjId: portal?.id || null,
        hasCreds: hasCreds,
      }
    })

  return (
    <div style={{ maxWidth: '800px', margin: '28px auto', padding: '0 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>Settings</h1>
          <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
            Company profile, review preferences, and county portal logins
          </p>
        </div>
        {saved && (
          <span style={{
            padding: '8px 16px',
            backgroundColor: contractorTheme.successSoft,
            borderRadius: '8px',
            fontSize: '13px',
            color: contractorTheme.success,
            fontWeight: '600',
          }}>
            Saved
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: contractorTheme.errorSoft,
          borderRadius: '8px',
          marginBottom: '16px',
          color: contractorTheme.error,
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSaveCompany}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Company information</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Company name</label>
            <input style={inputStyle} name="name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Address</label>
            <input style={inputStyle} name="address" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
          </div>
          <div style={grid2}>
            <div><label style={labelStyle}>City</label><input style={inputStyle} value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
            <div><label style={labelStyle}>Zip</label><input style={inputStyle} value={form.zip} onChange={e => setForm(p => ({ ...p, zip: e.target.value }))} /></div>
            <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><label style={labelStyle}>Email</label><input style={inputStyle} type="email" value={form.primary_email} onChange={e => setForm(p => ({ ...p, primary_email: e.target.value }))} /></div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>License</h2>
          <div style={grid2}>
            <div><label style={labelStyle}>Contractor license #</label><input style={inputStyle} value={form.license_number} onChange={e => setForm(p => ({ ...p, license_number: e.target.value }))} /></div>
            <div><label style={labelStyle}>Qualifier name</label><input style={inputStyle} value={form.qualifer_name} onChange={e => setForm(p => ({ ...p, qualifer_name: e.target.value }))} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Qualifier license #</label><input style={inputStyle} value={form.qualifer_license} onChange={e => setForm(p => ({ ...p, qualifer_license: e.target.value }))} /></div>
          </div>
          <p style={{ fontSize: '12px', color: contractorTheme.textMuted, margin: '16px 0 0 0' }}>Logo upload — coming soon</p>
        </div>

        <button type="submit" disabled={saving} style={{ ...contractorPrimaryButtonStyle(saving), marginBottom: '32px' }}>
          {saving ? 'Saving...' : 'Save company info'}
        </button>
      </form>

      <form onSubmit={handleSaveReviewGates}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Review preferences</h2>
          <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 16px 0' }}>
            Choose which stages Dart iQ should pause for your approval.
          </p>
          <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '16px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reviewGates.noc_before_send}
              onChange={e => setReviewGates(p => ({ ...p, noc_before_send: e.target.checked }))}
              style={{ marginTop: '4px' }}
            />
            <span>
              <strong style={{ display: 'block', color: contractorTheme.text, fontSize: '14px' }}>Review NOC before sending to homeowner</strong>
              <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
                Pause and show the NOC before it is sent for homeowner signature.
              </span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '20px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reviewGates.permit_before_submit}
              onChange={e => setReviewGates(p => ({ ...p, permit_before_submit: e.target.checked }))}
              style={{ marginTop: '4px' }}
            />
            <span>
              <strong style={{ display: 'block', color: contractorTheme.text, fontSize: '14px' }}>Review permit before county submission</strong>
              <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
                Pause and show all filled permit fields before submitting to the county.
              </span>
            </span>
          </label>
          {reviewError && <p style={{ color: contractorTheme.error, fontSize: '13px', marginBottom: '12px' }}>{reviewError}</p>}
          {reviewSaved && <p style={{ color: contractorTheme.success, fontSize: '13px', marginBottom: '12px' }}>Review preferences saved</p>}
          <button type="submit" disabled={reviewSaving} style={contractorPrimaryButtonStyle(reviewSaving)}>
            {reviewSaving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </form>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>AHJ portal credentials</h2>
        <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 20px 0' }}>
          Add county portal logins for the areas you selected during onboarding. Passwords are encrypted and never displayed.
        </p>

        {!encryptionConfigured && (
          <div style={{
            padding: '12px 16px',
            backgroundColor: contractorTheme.warningSoft,
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#92400e',
          }}>
            Server encryption is not configured. Contact your administrator to set CREDENTIAL_ENCRYPTION_KEY.
          </div>
        )}

        {coveredCountyRows.length === 0 ? (
          <p style={{ fontSize: '14px', color: contractorTheme.textMuted, margin: 0 }}>
            No counties selected yet. Complete onboarding coverage or contact support to update your service areas.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {coveredCountyRows.map(function (row) {
              return (
                <div
                  key={row.countyId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    padding: '14px 16px',
                    border: '1px solid ' + contractorTheme.border,
                    borderRadius: '10px',
                    backgroundColor: contractorTheme.inputBg || '#0f172a',
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: contractorTheme.text }}>{row.label}</p>
                    <p style={{
                      margin: '6px 0 0',
                      fontSize: '13px',
                      color: row.hasCreds ? contractorTheme.success : '#fbbf24',
                    }}>
                      {row.hasCreds ? 'Status: ✓ Credentials saved' : 'Status: ⚠️ Credentials not saved'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!encryptionConfigured}
                    onClick={function () { openCredModal(row) }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: contractorTheme.accent,
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: encryptionConfigured ? 'pointer' : 'not-allowed',
                      opacity: encryptionConfigured ? 1 : 0.6,
                    }}
                  >
                    {row.hasCreds ? 'Update Credentials' : 'Add Credentials'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {credModal ? (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(2, 6, 23, 0.72)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 60,
          padding: '16px',
        }}>
          <form
            onSubmit={handleSaveCredentialModal}
            style={{
              width: '100%',
              maxWidth: '420px',
              backgroundColor: contractorTheme.surface || '#0b1220',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '12px',
              padding: '22px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: contractorTheme.text, fontSize: '18px' }}>
              {credModal.hasCreds ? 'Update' : 'Add'} credentials
            </h3>
            <p style={{ margin: '0 0 16px', color: contractorTheme.textMuted, fontSize: '13px' }}>
              {credModal.label} portal login
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Portal username</label>
              <input
                style={inputStyle}
                value={credForm.username}
                onChange={function (e) { setCredForm(function (p) { return { ...p, username: e.target.value } }) }}
                autoComplete="off"
                required
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Portal password</label>
              <input
                style={inputStyle}
                type="password"
                value={credForm.password}
                onChange={function (e) { setCredForm(function (p) { return { ...p, password: e.target.value } }) }}
                autoComplete="new-password"
                required
              />
            </div>
            {credMessage ? (
              <p style={{
                fontSize: '13px',
                marginBottom: '12px',
                color: credMessage.includes('Failed') || credMessage.includes('required')
                  ? contractorTheme.error
                  : contractorTheme.success,
              }}>
                {credMessage}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={function () { setCredModal(null); setCredMessage('') }}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid ' + contractorTheme.border,
                  backgroundColor: 'transparent',
                  color: contractorTheme.textMuted,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={credSaving} style={contractorPrimaryButtonStyle(credSaving)}>
                {credSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
