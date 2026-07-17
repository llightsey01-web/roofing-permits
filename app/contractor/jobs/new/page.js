'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import {
  contractorTheme,
  contractorCardStyle,
  contractorPrimaryButtonStyle,
  contractorInputStyle,
} from '../../../../lib/ui/contractor-theme'

const emptyMaterial = { manufacturer: '', product_name: '', approval_number: '' }

const NOC_OPTION_CHOICES = [
  {
    value: 'auto_generate',
    label: 'Generate NOC automatically',
    description: 'DART iQ will fill out and send for online notarization',
    needsFile: false,
  },
  {
    value: 'upload_signed',
    label: 'I have a signed NOC to upload',
    description: 'Homeowner already signed — we will send for notarization',
    needsFile: true,
  },
  {
    value: 'upload_notarized',
    label: 'I have a notarized NOC to upload',
    description: 'Already signed and notarized — we will send for recording only',
    needsFile: true,
  },
  {
    value: 'upload_recorded',
    label: 'I have a recorded NOC to upload',
    description: 'Already signed, notarized, and recorded — skip to permit submission',
    needsFile: true,
  },
  {
    value: 'manual_download',
    label: 'Generate NOC for manual processing',
    description: 'Download the filled NOC PDF to print and sign manually',
    needsFile: false,
  },
]

const MAX_NOC_BYTES = 10 * 1024 * 1024

export default function ContractorNewJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [products, setProducts] = useState([])
  const [detectedAHJ, setDetectedAHJ] = useState(null)
  const [ahjLoading, setAhjLoading] = useState(false)
  const [allAHJs, setAllAHJs] = useState([])
  const [nocOption, setNocOption] = useState('auto_generate')
  const [nocFile, setNocFile] = useState(null)
  const [ahjCredStatus, setAhjCredStatus] = useState(null) // 'ready' | 'missing' | null
  const [settingsError, setSettingsError] = useState(null)

  const selectedNocChoice = NOC_OPTION_CHOICES.find(c => c.value === nocOption) || NOC_OPTION_CHOICES[0]

  const [form, setForm] = useState({
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    property_address: '',
    property_city: '',
    property_state: 'FL',
    property_zip: '',
    scope_of_work: '',
    roof_type: '',
    valuation: '',
    notes: '',
    squares: '',
    ahj_id: '',
  })

  const [showVentilation, setShowVentilation] = useState(false)
  const [primaryMaterial, setPrimaryMaterial] = useState({ ...emptyMaterial })
  const [underlayment, setUnderlayment] = useState({ ...emptyMaterial })
  const [ventilation, setVentilation] = useState({ ...emptyMaterial })

  useEffect(() => {
    const supabase = createClient()
    supabase.from('product_approvals').select('*').eq('is_active', true)
      .then(({ data }) => setProducts(data || []))
    supabase.from('ahj_portals').select('id, name, county_or_city').eq('is_active', true)
      .then(({ data }) => setAllAHJs(data || []))

    async function loadMaterialPrefs() {
      try {
        const { data: sessionData } = await safeGetSession(supabase)
        const token = sessionData?.session?.access_token
        if (!token) return
        const res = await fetch('/api/contractor/materials', {
          headers: { Authorization: 'Bearer ' + token },
        })
        const data = await res.json()
        if (!res.ok) return
        const materials = data.materials || []
        function firstOf(layer) {
          const row = materials.find(function (m) { return m.layer_type === layer })
          const p = row?.product
          if (!p) return null
          return {
            manufacturer: p.manufacturer || '',
            product_name: p.product_name || '',
            approval_number: p.approval_number || p.fl_approval_number || '',
          }
        }
        const primary = firstOf('primary')
        const under = firstOf('underlayment')
        const vent = firstOf('ventilation')
        if (primary) setPrimaryMaterial(primary)
        if (under) setUnderlayment(under)
        if (vent) {
          setVentilation(vent)
          setShowVentilation(true)
        }
      } catch (err) {
        console.warn('[jobs/new] material prefs load failed:', err.message)
      }
    }
    loadMaterialPrefs()
  }, [])

  async function checkAhjCredentials(ahj, token) {
    if (!ahj?.id || !token) {
      setAhjCredStatus(null)
      return
    }
    try {
      const credRes = await fetch('/api/contractor/credentials', {
        headers: { Authorization: 'Bearer ' + token },
      })
      const credData = await credRes.json()
      if (!credRes.ok) {
        setAhjCredStatus(null)
        return
      }
      const vault = credData.vaultCredentials || []
      const legacy = credData.credentials || []
      const hasVault = vault.some(function (c) {
        return c.ahj_id === ahj.id || (c.has_password && c.ahj_name && String(c.ahj_name).includes(String(ahj.name || '').split(' ')[0]))
      })
      const hasLegacy = legacy.some(function (c) { return c.ahj_id === ahj.id && c.has_password })
      setAhjCredStatus(hasVault || hasLegacy ? 'ready' : 'missing')
    } catch (err) {
      console.error('Credential status check failed:', err)
      setAhjCredStatus(null)
    }
  }

  async function handleAHJResolve() {
    if (!form.property_address || !form.property_city || !form.property_zip) return
    setAhjLoading(true)
    setDetectedAHJ(null)
    setAhjCredStatus(null)
    setSettingsError(null)
    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) { setAhjLoading(false); return }
      if (!session) { router.replace('/login'); setAhjLoading(false); return }

      const response = await fetch('/api/resolve-ahj', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          propertyAddress: form.property_address,
          propertyCity: form.property_city,
          propertyState: form.property_state,
          propertyZip: form.property_zip,
        }),
      })
      const result = await response.json()
      if (result.ahj) {
        setDetectedAHJ(result.ahj)
        setForm(prev => ({ ...prev, ahj_id: result.ahj.id }))
        await checkAhjCredentials(result.ahj, session.access_token)
      }
    } catch (err) {
      console.error('AHJ resolve error:', err)
    }
    setAhjLoading(false)
  }

  function getManufacturers(layerType) {
    const mfrs = products.filter(p => p.layer_type === layerType).map(p => p.manufacturer)
    return [...new Set(mfrs)].sort()
  }

  function getProducts(layerType, manufacturer) {
    return products
      .filter(p => p.layer_type === layerType && p.manufacturer === manufacturer)
      .sort((a, b) => a.product_name.localeCompare(b.product_name))
  }

  function handleMaterialChange(setter, field, value, layerType, currentState) {
    if (field === 'manufacturer') {
      setter({ manufacturer: value, product_name: '', approval_number: '' })
    } else if (field === 'product_name') {
      const match = products.find(
        p => p.layer_type === layerType &&
          p.manufacturer === currentState.manufacturer &&
          p.product_name === value
      )
      setter({ ...currentState, product_name: value, approval_number: match ? match.approval_number : '' })
    } else {
      setter(prev => ({ ...prev, [field]: value }))
    }
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleNocFileChange(e) {
    const file = e.target.files?.[0] || null
    if (!file) {
      setNocFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setError('NOC upload must be a PDF file.')
      e.target.value = ''
      setNocFile(null)
      return
    }
    if (file.size > MAX_NOC_BYTES) {
      setError('NOC PDF must be 10MB or smaller.')
      e.target.value = ''
      setNocFile(null)
      return
    }
    setError('')
    setNocFile(file)
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader()
      reader.onload = function () {
        const result = String(reader.result || '')
        const base64 = result.includes(',') ? result.split(',')[1] : result
        resolve(base64)
      }
      reader.onerror = function () { reject(new Error('Failed to read NOC file')) }
      reader.readAsDataURL(file)
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!primaryMaterial.manufacturer || !primaryMaterial.product_name) {
      setError('Primary material is required.')
      return
    }
    if (!underlayment.manufacturer || !underlayment.product_name) {
      setError('Underlayment is required.')
      return
    }
    if (selectedNocChoice.needsFile && !nocFile) {
      setError('Please upload a signed/notarized/recorded NOC PDF.')
      return
    }
    setLoading(true)
    setError('')
    setSuccess(false)

    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return
    if (!session) { router.replace('/login'); return }

    const payload = {
      ...form,
      ahj_id: form.ahj_id || null,
      valuation: form.valuation ? parseFloat(form.valuation) : null,
      roof_specs: {
        primary_material: primaryMaterial,
        underlayment: underlayment,
        ventilation: showVentilation ? ventilation : null,
      },
      job_specs: { squares: form.squares || null },
      noc_option: nocOption,
    }

    if (nocFile) {
      try {
        payload.noc_upload_base64 = await readFileAsBase64(nocFile)
      } catch (readErr) {
        setError(readErr.message || 'Failed to read NOC file')
        setLoading(false)
        return
      }
    }

    const response = await fetch('/api/contractor/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()
    if (!response.ok) {
      if (result.settingsUrl) {
        setSettingsError(result)
        setError(result.error || 'Failed to save application')
      } else {
        setSettingsError(null)
        setError(result.error || 'Failed to save application')
      }
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => router.push('/contractor/jobs/' + result.job.id), 1200)
    }
  }

  const inputStyle = contractorInputStyle()
  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    color: contractorTheme.text,
  }
  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px', boxSizing: 'border-box' }
  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: contractorTheme.text,
    marginBottom: '8px',
    marginTop: 0,
  }
  const sectionDescStyle = { fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 20px 0' }

  const subSectionStyle = {
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '16px',
    backgroundColor: contractorTheme.accentSoft,
  }

  const subLabelStyle = {
    fontSize: '11px',
    fontWeight: '600',
    color: contractorTheme.textMuted,
    marginBottom: '12px',
    marginTop: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  }

  function MaterialLayer({ title, layerType, values, setter }) {
    const manufacturers = getManufacturers(layerType)
    const productList = getProducts(layerType, values.manufacturer)
    const approvalFilled = Boolean(values.approval_number)
    return (
      <div style={subSectionStyle}>
        <p style={subLabelStyle}>{title}</p>
        <div className="contractor-form-grid">
          <div>
            <label style={labelStyle}>Manufacturer *</label>
            <select
              style={inputStyle}
              value={values.manufacturer}
              onChange={e => handleMaterialChange(setter, 'manufacturer', e.target.value, layerType, values)}
            >
              <option value="">Select manufacturer</option>
              {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Product name *</label>
            <select
              style={{
                ...inputStyle,
                opacity: values.manufacturer ? 1 : 0.7,
              }}
              value={values.product_name}
              onChange={e => handleMaterialChange(setter, 'product_name', e.target.value, layerType, values)}
              disabled={!values.manufacturer}
            >
              <option value="">{values.manufacturer ? 'Select product' : 'Select manufacturer first'}</option>
              {productList.map(p => <option key={p.id} value={p.product_name}>{p.product_name}</option>)}
            </select>
          </div>
          <div className="contractor-form-grid-full">
            <label style={labelStyle}>
              FL product approval #
              {approvalFilled && (
                <span style={{ marginLeft: '8px', fontSize: '11px', color: contractorTheme.success, fontWeight: '400' }}>
                  auto-filled
                </span>
              )}
            </label>
            <input
              style={{
                ...inputStyle,
                borderColor: approvalFilled ? contractorTheme.success : contractorTheme.border,
              }}
              value={values.approval_number}
              onChange={e => handleMaterialChange(setter, 'approval_number', e.target.value, layerType, values)}
              placeholder="Auto-fills when product is selected"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="contractor-page contractor-page-narrow">
      <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: '0 0 8px 0' }}>
        New permit application
      </h1>
      <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '0 0 24px 0' }}>
        Dart iQ will handle parcel lookup, permit drafting, NOC, and county submission.
      </p>

      {success && (
        <div
          style={{
            padding: '14px 18px',
            backgroundColor: contractorTheme.successSoft,
            borderRadius: '10px',
            marginBottom: '20px',
            color: contractorTheme.success,
            fontSize: '14px',
            fontWeight: '600',
            border: '1px solid ' + contractorTheme.border,
          }}
        >
          Application submitted successfully. Redirecting to your application...
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>1. Homeowner information</h2>
          <p style={sectionDescStyle}>Who owns the property and how can we reach them?</p>
          <div className="contractor-form-grid">
            <div>
              <label style={labelStyle}>Owner name *</label>
              <input style={inputStyle} name="owner_name" value={form.owner_name} onChange={handleChange} required />
            </div>
            <div>
              <label style={labelStyle}>Owner phone</label>
              <input style={inputStyle} name="owner_phone" value={form.owner_phone} onChange={handleChange} />
            </div>
            <div className="contractor-form-grid-full">
              <label style={labelStyle}>Owner email</label>
              <input style={inputStyle} type="email" name="owner_email" value={form.owner_email} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>2. Property location</h2>
          <p style={sectionDescStyle}>We use this address to detect the correct county AHJ.</p>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Street address *</label>
            <input style={inputStyle} name="property_address" value={form.property_address} onChange={handleChange} required />
          </div>
          <div className="contractor-form-grid">
            <div>
              <label style={labelStyle}>City *</label>
              <input style={inputStyle} name="property_city" value={form.property_city} onChange={handleChange} required />
            </div>
            <div>
              <label style={labelStyle}>State</label>
              <input style={inputStyle} name="property_state" value={form.property_state} onChange={handleChange} />
            </div>
            <div>
              <label style={labelStyle}>Zip *</label>
              <input
                style={inputStyle}
                name="property_zip"
                value={form.property_zip}
                onChange={handleChange}
                onBlur={handleAHJResolve}
                required
              />
            </div>
          </div>
          {ahjLoading && <p style={{ fontSize: '13px', color: contractorTheme.textMuted, marginTop: '12px' }}>Detecting AHJ...</p>}
          {detectedAHJ && !ahjLoading && (
            <div style={{
              marginTop: '14px',
              padding: '14px 16px',
              borderRadius: '10px',
              border: '1px solid ' + (ahjCredStatus === 'missing' ? '#f59e0b' : contractorTheme.border),
              backgroundColor: ahjCredStatus === 'missing' ? 'rgba(245, 158, 11, 0.12)' : contractorTheme.accentSoft,
            }}>
              <p style={{ margin: 0, fontSize: '14px', color: contractorTheme.text, fontWeight: 600 }}>
                📍 County detected: {detectedAHJ.name}
              </p>
              {ahjCredStatus === 'ready' ? (
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: contractorTheme.success }}>
                  ✓ Portal credentials on file — ready to submit
                </p>
              ) : null}
              {ahjCredStatus === 'missing' ? (
                <div style={{ marginTop: '8px' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: '#fbbf24' }}>
                    ⚠️ No portal credentials saved for {detectedAHJ.name}
                  </p>
                  <p style={{ margin: '6px 0 10px', fontSize: '13px', color: contractorTheme.textMuted }}>
                    Add your credentials in Settings before submitting
                  </p>
                  <button
                    type="button"
                    onClick={function () { router.push('/contractor/settings') }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: contractorTheme.accent,
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Go to Settings
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {!detectedAHJ && !ahjLoading && form.property_zip.length === 5 && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>Select AHJ manually</label>
              <select
                style={inputStyle}
                value={form.ahj_id}
                onChange={async function (e) {
                  const ahjId = e.target.value
                  setForm(function (prev) { return { ...prev, ahj_id: ahjId } })
                  const ahj = allAHJs.find(function (a) { return a.id === ahjId }) || null
                  setDetectedAHJ(ahj)
                  if (ahj) {
                    const supabase = createClient()
                    const { session } = await safeGetSession(supabase)
                    if (session) await checkAhjCredentials(ahj, session.access_token)
                  } else {
                    setAhjCredStatus(null)
                  }
                }}
              >
                <option value="">Select AHJ</option>
                {allAHJs.map(ahj => <option key={ahj.id} value={ahj.id}>{ahj.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>3. NOC (Notice of Commencement)</h2>
          <p style={sectionDescStyle}>How would you like to handle the NOC for this job?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {NOC_OPTION_CHOICES.map(function (choice) {
              const selected = nocOption === choice.value
              return (
                <label
                  key={choice.value}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid ' + (selected ? contractorTheme.accent : contractorTheme.border),
                    backgroundColor: selected ? contractorTheme.accentSoft : contractorTheme.inputBg,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="noc_option"
                    value={choice.value}
                    checked={selected}
                    onChange={function () {
                      setNocOption(choice.value)
                      if (!choice.needsFile) setNocFile(null)
                    }}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: contractorTheme.text }}>
                      {choice.label}
                    </span>
                    <span style={{ display: 'block', fontSize: '13px', color: contractorTheme.textMuted, marginTop: '4px' }}>
                      {choice.description}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {selectedNocChoice.needsFile ? (
            <div style={{ marginTop: '16px' }}>
              <label style={labelStyle}>Upload NOC PDF (max 10MB) *</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleNocFileChange}
                style={{ ...inputStyle, padding: '10px' }}
              />
              {nocFile ? (
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: contractorTheme.success }}>
                  Selected: {nocFile.name}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>4. Job details</h2>
          <p style={sectionDescStyle}>Scope, roof type, and contract value for the permit.</p>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Scope of work</label>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical', minHeight: '80px' }}
              name="scope_of_work"
              value={form.scope_of_work}
              onChange={handleChange}
            />
          </div>
          <div className="contractor-form-grid">
            <div>
              <label style={labelStyle}>Roof type</label>
              <select style={inputStyle} name="roof_type" value={form.roof_type} onChange={handleChange}>
                <option value="">Select roof type</option>
                {['Shingle', 'Tile', 'Metal', 'Flat', 'Modified Bitumen'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Squares</label>
              <input style={inputStyle} type="number" name="squares" value={form.squares} onChange={handleChange} placeholder="e.g. 24" />
            </div>
            <div>
              <label style={labelStyle}>Contract value ($)</label>
              <input style={inputStyle} type="number" name="valuation" value={form.valuation} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>5. Materials and product approvals</h2>
          <p style={sectionDescStyle}>Florida-approved products by layer. Approval numbers auto-fill from the database.</p>
          <MaterialLayer title="Primary material" layerType="primary" values={primaryMaterial} setter={setPrimaryMaterial} />
          <MaterialLayer title="Underlayment" layerType="underlayment" values={underlayment} setter={setUnderlayment} />
          {showVentilation ? (
            <div>
              <MaterialLayer title="Ventilation" layerType="ventilation" values={ventilation} setter={setVentilation} />
              <button
                type="button"
                onClick={() => { setShowVentilation(false); setVentilation({ ...emptyMaterial }) }}
                style={{
                  fontSize: '14px',
                  color: contractorTheme.error,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '12px 0',
                  marginBottom: '16px',
                  display: 'block',
                  minHeight: '44px',
                }}
              >
                Remove ventilation
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowVentilation(true)}
              style={{
                fontSize: '14px',
                color: contractorTheme.accent,
                background: 'transparent',
                border: '1px dashed ' + contractorTheme.border,
                borderRadius: '10px',
                cursor: 'pointer',
                padding: '14px 16px',
                width: '100%',
                minHeight: '44px',
                textAlign: 'center',
                fontWeight: '500',
              }}
            >
              + Add Ventilation Product
            </button>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>6. Internal notes</h2>
          <p style={sectionDescStyle}>Optional notes visible only to your team.</p>
          <textarea
            style={{ ...inputStyle, height: '80px', resize: 'vertical', minHeight: '80px' }}
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Gate codes, special instructions, etc."
          />
        </div>

        {error && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: contractorTheme.errorSoft,
            border: '1px solid ' + contractorTheme.border,
          }}>
            <p style={{ color: contractorTheme.error, fontSize: '14px', margin: 0 }}>{error}</p>
            {settingsError?.settingsUrl ? (
              <button
                type="button"
                onClick={function () { router.push(settingsError.settingsUrl) }}
                style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: contractorTheme.accent,
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Settings{settingsError.ahj ? ' (' + settingsError.ahj + ')' : ''}
              </button>
            ) : null}
          </div>
        )}

        <div className="contractor-form-actions">
          <button
            type="button"
            className="contractor-btn-cancel"
            onClick={() => router.push('/contractor/dashboard')}
            style={{
              padding: '12px 24px',
              minHeight: '44px',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '10px',
              backgroundColor: contractorTheme.inputBg,
              fontSize: '15px',
              cursor: 'pointer',
              color: contractorTheme.textBody,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || success}
            className="contractor-btn-primary"
            style={contractorPrimaryButtonStyle(loading || success)}
          >
            {loading ? 'Submitting...' : 'Start Permit Application'}
          </button>
        </div>
      </form>
    </div>
  )
}
