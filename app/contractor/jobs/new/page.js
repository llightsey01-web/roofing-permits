'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import { contractorTheme, contractorCardStyle, contractorPrimaryButtonStyle } from '../../../../lib/ui/contractor-theme'

const emptyMaterial = { manufacturer: '', product_name: '', approval_number: '' }

export default function ContractorNewJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [products, setProducts] = useState([])
  const [detectedAHJ, setDetectedAHJ] = useState(null)
  const [ahjLoading, setAhjLoading] = useState(false)
  const [allAHJs, setAllAHJs] = useState([])

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
  }, [])

  async function handleAHJResolve() {
    if (!form.property_address || !form.property_city || !form.property_zip) return
    setAhjLoading(true)
    setDetectedAHJ(null)
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
      setError(result.error || 'Failed to save application')
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => router.push('/contractor/jobs/' + result.job.id), 1200)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '11px 14px',
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    fontSize: '14px',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
    color: contractorTheme.textBody,
  }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: contractorTheme.text }
  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: contractorTheme.text,
    marginBottom: '8px',
    marginTop: 0,
  }
  const sectionDescStyle = { fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 20px 0' }
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }

  const subSectionStyle = {
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '16px',
    backgroundColor: contractorTheme.accentSoft || 'rgba(59, 130, 246, 0.08)',
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
        <div style={gridStyle}>
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
                backgroundColor: values.manufacturer ? inputStyle.backgroundColor : contractorTheme.accentSoft,
                opacity: values.manufacturer ? 1 : 0.85,
              }}
              value={values.product_name}
              onChange={e => handleMaterialChange(setter, 'product_name', e.target.value, layerType, values)}
              disabled={!values.manufacturer}
            >
              <option value="">{values.manufacturer ? 'Select product' : 'Select manufacturer first'}</option>
              {productList.map(p => <option key={p.id} value={p.product_name}>{p.product_name}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
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
                backgroundColor: approvalFilled ? contractorTheme.successSoft : inputStyle.backgroundColor,
                borderColor: approvalFilled ? '#86efac' : contractorTheme.border,
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
    <div style={{ maxWidth: '800px', margin: '28px auto', padding: '0 24px 48px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: '0 0 8px 0' }}>
        New permit application
      </h1>
      <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '0 0 24px 0' }}>
        Dart iQ will handle parcel lookup, permit drafting, NOC, and county submission.
      </p>

      {success && (
        <div style={{
          padding: '14px 18px',
          backgroundColor: contractorTheme.successSoft,
          borderRadius: '10px',
          marginBottom: '20px',
          color: contractorTheme.success,
          fontSize: '14px',
          fontWeight: '600',
          border: '1px solid #bbf7d0',
        }}>
          Application submitted successfully. Redirecting to your application...
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>1. Homeowner information</h2>
          <p style={sectionDescStyle}>Who owns the property and how can we reach them?</p>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Owner name *</label>
              <input style={inputStyle} name="owner_name" value={form.owner_name} onChange={handleChange} required />
            </div>
            <div>
              <label style={labelStyle}>Owner phone</label>
              <input style={inputStyle} name="owner_phone" value={form.owner_phone} onChange={handleChange} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
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
          <div style={gridStyle}>
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
            <p style={{ fontSize: '13px', marginTop: '12px', color: contractorTheme.accent }}>
              AHJ detected: <strong>{detectedAHJ.name}</strong>
            </p>
          )}
          {!detectedAHJ && !ahjLoading && form.property_zip.length === 5 && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>Select AHJ manually</label>
              <select
                style={inputStyle}
                value={form.ahj_id}
                onChange={e => setForm(prev => ({ ...prev, ahj_id: e.target.value }))}
              >
                <option value="">Select AHJ</option>
                {allAHJs.map(ahj => <option key={ahj.id} value={ahj.id}>{ahj.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>3. Job details</h2>
          <p style={sectionDescStyle}>Scope, roof type, and contract value for the permit.</p>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Scope of work</label>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              name="scope_of_work"
              value={form.scope_of_work}
              onChange={handleChange}
            />
          </div>
          <div style={gridStyle}>
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
          <h2 style={sectionTitleStyle}>4. Materials and product approvals</h2>
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
                  fontSize: '13px',
                  color: contractorTheme.error,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0',
                  marginBottom: '16px',
                  display: 'block',
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
                fontSize: '13px',
                color: contractorTheme.accent,
                background: 'transparent',
                border: '1px dashed ' + contractorTheme.border,
                borderRadius: '10px',
                cursor: 'pointer',
                padding: '12px 16px',
                width: '100%',
                textAlign: 'center',
                fontWeight: '500',
              }}
            >
              + Add Ventilation Product
            </button>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>5. Internal notes</h2>
          <p style={sectionDescStyle}>Optional notes visible only to your team.</p>
          <textarea
            style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Gate codes, special instructions, etc."
          />
        </div>

        {error && (
          <p style={{ color: contractorTheme.error, fontSize: '14px', marginBottom: '16px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => router.push('/contractor/dashboard')}
            style={{
              padding: '12px 24px',
              border: '1px solid ' + contractorTheme.border,
              borderRadius: '10px',
              backgroundColor: '#ffffff',
              fontSize: '14px',
              cursor: 'pointer',
              color: contractorTheme.textBody,
            }}
          >
            Cancel
          </button>
          <button type="submit" disabled={loading || success} style={contractorPrimaryButtonStyle(loading || success)}>
            {loading ? 'Submitting...' : 'Start Permit Application'}
          </button>
        </div>
      </form>
    </div>
  )
}
