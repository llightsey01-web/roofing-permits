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

const MS_DAY = 24 * 60 * 60 * 1000

function daysSince(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / MS_DAY)
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function credentialLabel(cred) {
  return cred.ahj_name || cred.ahj_county || cred.provider || 'County portal'
}

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

  const [vaultCredentials, setVaultCredentials] = useState([])
  const [ahjs, setAhjs] = useState([])
  const [encryptionConfigured, setEncryptionConfigured] = useState(true)
  const [credModal, setCredModal] = useState(null) // { mode: 'add'|'update', credential?, ahjId? }
  const [credForm, setCredForm] = useState({ ahj_id: '', username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [credSaving, setCredSaving] = useState(false)
  const [credMessage, setCredMessage] = useState('')
  const [credFlash, setCredFlash] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [reviewGates, setReviewGates] = useState({
    noc_before_send: false,
    permit_before_submit: false,
    auto_approve_all: true,
  })
  const [reviewSaving, setReviewSaving] = useState(false)
  const [reviewSaved, setReviewSaved] = useState(false)
  const [reviewError, setReviewError] = useState('')

  useEffect(function () {
    loadAll()
  }, [])

  useEffect(function () {
    if (!credFlash) return undefined
    const t = setTimeout(function () { setCredFlash('') }, 4000)
    return function () { clearTimeout(t) }
  }, [credFlash])

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
        supabase
          .from('ahj_portals')
          .select('id, name, county_or_city, portal_url')
          .eq('is_active', true)
          .order('name'),
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
      }

      const credData = await credRes.json()
      if (credRes.ok) {
        const vault = (credData.vaultCredentials || []).filter(function (c) {
          return c.is_active !== false && (c.credential_type === 'ahj_portal' || !c.credential_type || String(c.provider || '').includes('accela') || c.ahj_id)
        })
        setVaultCredentials(vault.length ? vault : (credData.vaultCredentials || []).filter(function (c) {
          return c.is_active !== false
        }))
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
      setTimeout(function () { setReviewSaved(false) }, 3000)
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
      setTimeout(function () { setSaved(false) }, 3000)
    }
    setSaving(false)
  }

  function openAddModal() {
    setCredModal({ mode: 'add' })
    setCredForm({ ahj_id: '', username: '', password: '' })
    setShowPassword(false)
    setCredMessage('')
  }

  function openUpdateModal(cred) {
    setCredModal({ mode: 'update', credential: cred })
    setCredForm({
      ahj_id: cred.ahj_id || '',
      username: cred.username || '',
      password: '',
    })
    setShowPassword(false)
    setCredMessage('')
  }

  function closeCredModal() {
    setCredModal(null)
    setCredMessage('')
    setShowPassword(false)
  }

  async function handleSaveCredentialModal(e) {
    e.preventDefault()
    if (!credModal) return
    setCredSaving(true)
    setCredMessage('')

    const ahjId = credModal.mode === 'update'
      ? (credModal.credential?.ahj_id || credForm.ahj_id)
      : credForm.ahj_id

    if (!ahjId) {
      setCredMessage('Select a county portal')
      setCredSaving(false)
      return
    }
    if (!credForm.username.trim() || !credForm.password) {
      setCredMessage('Username and password are required')
      setCredSaving(false)
      return
    }

    const token = await getToken()
    const response = await fetch('/api/contractor/credentials/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        ahj_id: ahjId,
        username: credForm.username.trim(),
        password: credForm.password,
        is_update: credModal.mode === 'update',
        credential_id: credModal.credential?.id || null,
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      setCredMessage(result.error || 'Failed to save credential')
      setCredSaving(false)
      return
    }

    setCredFlash(result.message || ('✓ ' + (result.ahj_name || 'Credentials') + ' saved'))
    closeCredModal()
    await loadAll()
    setCredSaving(false)
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    const token = await getToken()
    const response = await fetch('/api/contractor/credentials/' + deleteConfirm.id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    })
    const result = await response.json()
    setDeleting(false)
    if (!response.ok) {
      setCredFlash(result.error || 'Failed to delete credentials')
      setDeleteConfirm(null)
      return
    }
    setCredFlash('Credentials removed')
    setDeleteConfirm(null)
    await loadAll()
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>Loading settings...</p>
      </div>
    )
  }

  const inputStyle = {
    ...contractorInputStyle(),
    width: '100%',
    boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    color: contractorTheme.text,
  }
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
  const secondaryBtn = {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid ' + contractorTheme.border,
    backgroundColor: 'transparent',
    color: contractorTheme.textMuted,
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div style={{ maxWidth: '800px', margin: '28px auto', padding: '0 24px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>Settings</h1>
          <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
            Company profile, review preferences, and county portal logins
          </p>
        </div>
        {saved ? (
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
        ) : null}
      </div>

      {error ? (
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
      ) : null}

      {credFlash ? (
        <div style={{
          padding: '12px 14px',
          marginBottom: '16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.35)',
          color: '#10b981',
          fontSize: '13px',
          fontWeight: 600,
        }}>
          {credFlash}
        </div>
      ) : null}

      <form onSubmit={handleSaveCompany}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Company information</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Company name</label>
            <input style={inputStyle} name="name" value={form.name} onChange={function (e) { setForm(function (p) { return { ...p, name: e.target.value } }) }} required />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Address</label>
            <input style={inputStyle} name="address" value={form.address} onChange={function (e) { setForm(function (p) { return { ...p, address: e.target.value } }) }} />
          </div>
          <div style={grid2}>
            <div><label style={labelStyle}>City</label><input style={inputStyle} value={form.city} onChange={function (e) { setForm(function (p) { return { ...p, city: e.target.value } }) }} /></div>
            <div><label style={labelStyle}>Zip</label><input style={inputStyle} value={form.zip} onChange={function (e) { setForm(function (p) { return { ...p, zip: e.target.value } }) }} /></div>
            <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.phone} onChange={function (e) { setForm(function (p) { return { ...p, phone: e.target.value } }) }} /></div>
            <div><label style={labelStyle}>Email</label><input style={inputStyle} type="email" value={form.primary_email} onChange={function (e) { setForm(function (p) { return { ...p, primary_email: e.target.value } }) }} /></div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>License</h2>
          <div style={grid2}>
            <div><label style={labelStyle}>Contractor license #</label><input style={inputStyle} value={form.license_number} onChange={function (e) { setForm(function (p) { return { ...p, license_number: e.target.value } }) }} /></div>
            <div><label style={labelStyle}>Qualifier name</label><input style={inputStyle} value={form.qualifer_name} onChange={function (e) { setForm(function (p) { return { ...p, qualifer_name: e.target.value } }) }} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Qualifier license #</label><input style={inputStyle} value={form.qualifer_license} onChange={function (e) { setForm(function (p) { return { ...p, qualifer_license: e.target.value } }) }} /></div>
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
              onChange={function (e) { setReviewGates(function (p) { return { ...p, noc_before_send: e.target.checked } }) }}
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
              onChange={function (e) { setReviewGates(function (p) { return { ...p, permit_before_submit: e.target.checked } }) }}
              style={{ marginTop: '4px' }}
            />
            <span>
              <strong style={{ display: 'block', color: contractorTheme.text, fontSize: '14px' }}>Review permit before county submission</strong>
              <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
                Pause and show all filled permit fields before submitting to the county.
              </span>
            </span>
          </label>
          {reviewError ? <p style={{ color: contractorTheme.error, fontSize: '13px', marginBottom: '12px' }}>{reviewError}</p> : null}
          {reviewSaved ? <p style={{ color: contractorTheme.success, fontSize: '13px', marginBottom: '12px' }}>Review preferences saved</p> : null}
          <button type="submit" disabled={reviewSaving} style={contractorPrimaryButtonStyle(reviewSaving)}>
            {reviewSaving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </form>

      {/* AHJ PORTAL CREDENTIALS */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>AHJ Portal Credentials</h2>
        <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 16px 0' }}>
          Manage your county portal login credentials.
          These are used by DART iQ to submit permits on your behalf.
        </p>

        {!encryptionConfigured ? (
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
        ) : null}

        <button
          type="button"
          disabled={!encryptionConfigured}
          onClick={openAddModal}
          style={{
            ...contractorPrimaryButtonStyle(!encryptionConfigured),
            marginBottom: '20px',
          }}
        >
          + Add AHJ Credentials
        </button>

        <h3 style={{
          margin: '0 0 12px',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: contractorTheme.textMuted,
        }}>
          Saved Credentials
        </h3>

        {vaultCredentials.length === 0 ? (
          <p style={{ fontSize: '14px', color: contractorTheme.textMuted, margin: 0 }}>
            No portal credentials saved yet. Add credentials for each county where you submit permits.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {vaultCredentials.map(function (cred) {
              const label = credentialLabel(cred)
              const ageDays = daysSince(cred.last_used_at || cred.updated_at)
              const expiredLikely = ageDays != null && ageDays > 90
              const mayExpire = ageDays != null && ageDays > 60 && !expiredLikely

              return (
                <div
                  key={cred.id}
                  style={{
                    padding: '14px 16px',
                    border: '1px solid ' + contractorTheme.border,
                    borderRadius: '10px',
                    backgroundColor: contractorTheme.inputBg || 'transparent',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: contractorTheme.text }}>
                        {label}
                      </p>
                      <p style={{ margin: '6px 0 0', fontSize: '13px', color: contractorTheme.success }}>
                        ✓ Saved
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: contractorTheme.textMuted }}>
                        Last updated: {formatDate(cred.updated_at || cred.last_used_at)}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={function () { openUpdateModal(cred) }} style={secondaryBtn}>
                        Update
                      </button>
                      <button
                        type="button"
                        onClick={function () { setDeleteConfirm(cred) }}
                        style={{ ...secondaryBtn, color: contractorTheme.error, borderColor: 'rgba(239,68,68,0.35)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {mayExpire ? (
                    <div style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: contractorTheme.warningSoft,
                      border: '1px solid rgba(251, 191, 36, 0.35)',
                    }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#fbbf24', fontWeight: 600 }}>
                        ⚠️ {label} credentials may be expired
                      </p>
                      <p style={{ margin: '4px 0 10px', fontSize: '12px', color: contractorTheme.textMuted }}>
                        Most county portals require password reset every 90 days.
                      </p>
                      <button type="button" onClick={function () { openUpdateModal(cred) }} style={secondaryBtn}>
                        Update Credentials
                      </button>
                    </div>
                  ) : null}

                  {expiredLikely ? (
                    <div style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: contractorTheme.errorSoft,
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                    }}>
                      <p style={{ margin: 0, fontSize: '13px', color: contractorTheme.error, fontWeight: 600 }}>
                        🔴 {label} credentials likely expired
                      </p>
                      <p style={{ margin: '4px 0 10px', fontSize: '12px', color: contractorTheme.textMuted }}>
                        Please update your portal password.
                      </p>
                      <button type="button" onClick={function () { openUpdateModal(cred) }} style={secondaryBtn}>
                        Update Credentials
                      </button>
                    </div>
                  ) : null}
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
              maxWidth: '440px',
              backgroundColor: contractorTheme.surface || '#0b1220',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '12px',
              padding: '22px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: contractorTheme.text, fontSize: '18px' }}>
              {credModal.mode === 'update' ? 'Update credentials' : 'Add AHJ Credentials'}
            </h3>
            <p style={{ margin: '0 0 16px', color: contractorTheme.textMuted, fontSize: '13px' }}>
              {credModal.mode === 'update'
                ? 'Enter a new password to overwrite the saved portal login.'
                : 'Select a county portal and enter your login.'}
            </p>

            {credModal.mode === 'add' ? (
              <div style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>Select County Portal</label>
                <select
                  style={inputStyle}
                  value={credForm.ahj_id}
                  onChange={function (e) { setCredForm(function (p) { return { ...p, ahj_id: e.target.value } }) }}
                  required
                >
                  <option value="">Choose a portal…</option>
                  {ahjs.map(function (ahj) {
                    return (
                      <option key={ahj.id} value={ahj.id}>
                        {ahj.name || ahj.county_or_city}
                      </option>
                    )
                  })}
                </select>
              </div>
            ) : (
              <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: contractorTheme.text }}>
                {credentialLabel(credModal.credential)}
              </p>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Portal Username</label>
              <input
                style={inputStyle}
                value={credForm.username}
                onChange={function (e) { setCredForm(function (p) { return { ...p, username: e.target.value } }) }}
                autoComplete="off"
                required
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Portal Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  type={showPassword ? 'text' : 'password'}
                  value={credForm.password}
                  onChange={function (e) { setCredForm(function (p) { return { ...p, password: e.target.value } }) }}
                  autoComplete="new-password"
                  placeholder={credModal.mode === 'update' ? 'Enter new password' : ''}
                  required
                />
                <button
                  type="button"
                  onClick={function () { setShowPassword(function (v) { return !v }) }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'transparent',
                    color: contractorTheme.textMuted,
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '4px',
                  }}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {credMessage ? (
              <p style={{
                fontSize: '13px',
                marginBottom: '12px',
                color: contractorTheme.error,
              }}>
                {credMessage}
              </p>
            ) : null}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={closeCredModal} style={secondaryBtn}>
                Cancel
              </button>
              <button type="submit" disabled={credSaving} style={contractorPrimaryButtonStyle(credSaving)}>
                {credSaving ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteConfirm ? (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(2, 6, 23, 0.72)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 70,
          padding: '16px',
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: contractorTheme.surface || '#0b1220',
            border: '1px solid ' + contractorTheme.border,
            borderRadius: '12px',
            padding: '22px',
          }}>
            <h3 style={{ margin: '0 0 10px', color: contractorTheme.text, fontSize: '17px' }}>
              Remove credentials?
            </h3>
            <p style={{ margin: '0 0 18px', color: contractorTheme.textBody, fontSize: '14px', lineHeight: 1.55 }}>
              Are you sure? This will remove your {credentialLabel(deleteConfirm)} credentials.
              DART iQ will not be able to submit permits in this county until you add them again.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={deleting}
                onClick={function () { setDeleteConfirm(null) }}
                style={secondaryBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                style={{
                  ...contractorPrimaryButtonStyle(deleting),
                  backgroundColor: '#dc2626',
                }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
