'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, safeGetUser, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import { contractorTheme, contractorCardStyle } from '../../../lib/ui/contractor-theme'

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
  const [ahjs, setAhjs] = useState([])
  const [encryptionConfigured, setEncryptionConfigured] = useState(true)
  const [credForm, setCredForm] = useState({ ahj_id: '', username: '', password: '', notes: '' })
  const [editingCred, setEditingCred] = useState(null)
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
    }

    const credData = await credRes.json()
    if (credRes.ok) {
      setCredentials(credData.credentials || [])
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

  async function handleSaveCredential(e) {
    e.preventDefault()
    setCredSaving(true)
    setCredMessage('')
    const token = await getToken()

    const isEdit = Boolean(editingCred)
    const url = isEdit ? '/api/contractor/credentials/' + editingCred.id : '/api/contractor/credentials'
    const body = isEdit
      ? { username: credForm.username, password: credForm.password || undefined, notes: credForm.notes }
      : credForm

    if (!isEdit && (!credForm.ahj_id || !credForm.username || !credForm.password)) {
      setCredMessage('AHJ, username, and password are required')
      setCredSaving(false)
      return
    }

    const response = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    })
    const result = await response.json()

    if (!response.ok) {
      setCredMessage(result.error || 'Failed to save credential')
    } else {
      setCredMessage(isEdit ? 'Credential updated' : 'Credential added')
      setCredForm({ ahj_id: '', username: '', password: '', notes: '' })
      setEditingCred(null)
      await loadAll()
    }
    setCredSaving(false)
  }

  async function handleDeleteCredential(id) {
    if (!confirm('Delete this AHJ credential?')) return
    const token = await getToken()
    const response = await fetch('/api/contractor/credentials/' + id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    })
    if (response.ok) await loadAll()
  }

  function startEdit(cred) {
    setEditingCred(cred)
    setCredForm({ ahj_id: cred.ahj_id, username: cred.username, password: '', notes: cred.notes || '' })
    setCredMessage('')
  }

  function cancelEdit() {
    setEditingCred(null)
    setCredForm({ ahj_id: '', username: '', password: '', notes: '' })
    setCredMessage('')
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}><p style={{ color: '#64748b' }}>Loading settings...</p></div>
  }

  const inputStyle = {
    width: '100%', padding: '11px 14px', border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: 'white',
  }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: contractorTheme.text }
  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = { fontSize: '16px', fontWeight: '600', color: contractorTheme.text, marginBottom: '20px', marginTop: 0, paddingBottom: '12px', borderBottom: '1px solid ' + contractorTheme.border }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }

  const configuredAhjIds = new Set(credentials.map(c => c.ahj_id))
  const availableAhjs = ahjs.filter(a => !configuredAhjIds.has(a.id) || (editingCred && a.id === editingCred.ahj_id))

  return (
    <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
            <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>Your company</h1>
            <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>Profile info and permit portal logins</p>
        </div>
        {saved && (
          <span style={{ padding: '8px 16px', backgroundColor: '#dcfce7', borderRadius: '8px', fontSize: '13px', color: '#15803d' }}>
            Saved
          </span>
        )}
      </div>

      {error && <div style={{ padding: '12px', backgroundColor: '#fee2e2', borderRadius: '8px', marginBottom: '16px', color: '#b91c1c', fontSize: '14px' }}>{error}</div>}

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
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '16px 0 0 0' }}>Logo upload — coming soon</p>
        </div>

        <button type="submit" disabled={saving} style={{
          padding: '12px 28px', backgroundColor: saving ? '#94a3b8' : '#2563eb',
          color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', marginBottom: '32px',
        }}>
          {saving ? 'Saving...' : 'Save company info'}
        </button>
      </form>

      <form onSubmit={handleSaveReviewGates}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Review Preferences</h2>
          <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 16px 0' }}>
            Choose which stages you want to review before automation continues.
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
                We&apos;ll pause and show you the NOC before sending it to your customer for signing.
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
              <strong style={{ display: 'block', color: contractorTheme.text, fontSize: '14px' }}>Review permit before submitting to county</strong>
              <span style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
                We&apos;ll pause and show you all filled permit fields before submitting to Polk County.
              </span>
            </span>
          </label>
          {reviewError && <p style={{ color: '#b91c1c', fontSize: '13px', marginBottom: '12px' }}>{reviewError}</p>}
          {reviewSaved && <p style={{ color: '#15803d', fontSize: '13px', marginBottom: '12px' }}>Review preferences saved</p>}
          <button type="submit" disabled={reviewSaving} style={{
            padding: '10px 20px', backgroundColor: reviewSaving ? '#94a3b8' : contractorTheme.accent,
            color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
          }}>
            {reviewSaving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </form>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>AHJ portal credentials</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>
          Securely store login credentials for county permit portals (Polk, Orange FastTrack, Hillsborough, Accela, etc.).
          Passwords are encrypted server-side and never displayed.
        </p>

        {!encryptionConfigured && (
          <div style={{ padding: '12px 16px', backgroundColor: '#fef3c7', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#92400e' }}>
            Server encryption is not configured. Contact your administrator to set CREDENTIAL_ENCRYPTION_KEY.
          </div>
        )}

        {credentials.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            {credentials.map(cred => (
              <div key={cred.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '10px',
              }}>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: '#0f172a' }}>
                    {cred.ahj_name || 'AHJ portal'}
                  </p>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
                    User: {cred.username} · Password: {cred.password_masked}
                  </p>
                  {cred.notes && <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>{cred.notes}</p>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => startEdit(cred)} style={{ fontSize: '13px', padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer' }}>
                    Update
                  </button>
                  <button type="button" onClick={() => handleDeleteCredential(cred.id)} style={{ fontSize: '13px', padding: '6px 12px', border: '1px solid #fecaca', borderRadius: '6px', backgroundColor: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSaveCredential} style={{ border: '1px solid #f1f5f9', borderRadius: '10px', padding: '20px', backgroundColor: '#fafafa' }}>
          <p style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 16px 0', color: '#0f172a' }}>
            {editingCred ? 'Update credential' : 'Add credential'}
          </p>
          <div style={grid2}>
            {!editingCred && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>AHJ portal *</label>
                <select style={inputStyle} value={credForm.ahj_id} onChange={e => setCredForm(p => ({ ...p, ahj_id: e.target.value }))} required>
                  <option value="">Select AHJ</option>
                  {availableAhjs.map(a => <option key={a.id} value={a.id}>{a.name} ({a.county_or_city})</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Username *</label>
              <input style={inputStyle} value={credForm.username} onChange={e => setCredForm(p => ({ ...p, username: e.target.value }))} required />
            </div>
            <div>
              <label style={labelStyle}>{editingCred ? 'New password (leave blank to keep)' : 'Password *'}</label>
              <input style={inputStyle} type="password" value={credForm.password} onChange={e => setCredForm(p => ({ ...p, password: e.target.value }))} autoComplete="new-password" required={!editingCred} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notes</label>
              <input style={inputStyle} value={credForm.notes} onChange={e => setCredForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'center' }}>
            <button type="submit" disabled={credSaving || !encryptionConfigured} style={{
              padding: '10px 20px', backgroundColor: credSaving || !encryptionConfigured ? '#94a3b8' : '#2563eb',
              color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
            }}>
              {credSaving ? 'Saving...' : editingCred ? 'Replace credential' : 'Add credential'}
            </button>
            {editingCred && (
              <button type="button" onClick={cancelEdit} style={{ padding: '10px 20px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: 'white', fontSize: '14px', cursor: 'pointer' }}>
                Cancel
              </button>
            )}
            <button type="button" disabled title="Coming soon" style={{
              padding: '10px 20px', border: '1px solid #e2e8f0', borderRadius: '8px',
              backgroundColor: '#f8fafc', fontSize: '14px', color: '#94a3b8', cursor: 'not-allowed',
            }}>
              Test connection (soon)
            </button>
          </div>
          {credMessage && (
            <p style={{ fontSize: '13px', marginTop: '12px', color: credMessage.includes('Failed') || credMessage.includes('required') ? '#b91c1c' : '#15803d' }}>
              {credMessage}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
