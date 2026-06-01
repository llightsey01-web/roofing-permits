'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import { contractorTheme, contractorCardStyle } from '../../../../lib/ui/contractor-theme'

const emptyMaterial = { manufacturer: '', product_name: '', approval_number: '' }

export default function ContractorNewJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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

  const [primaryMaterial, setPrimaryMaterial] = useState({ ...emptyMaterial })

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
      const response = await fetch('/api/resolve-ahj', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  function getManufacturers() {
    const mfrs = products.filter(p => p.layer_type === 'primary').map(p => p.manufacturer)
    return [...new Set(mfrs)].sort()
  }

  function getProducts(manufacturer) {
    return products
      .filter(p => p.layer_type === 'primary' && p.manufacturer === manufacturer)
      .sort((a, b) => a.product_name.localeCompare(b.product_name))
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return
    if (!session) { router.replace('/login'); return }

    const payload = {
      ...form,
      ahj_id: form.ahj_id || null,
      valuation: form.valuation ? parseFloat(form.valuation) : null,
      roof_specs: primaryMaterial.manufacturer ? { primary_material: primaryMaterial } : {},
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
      setError(result.error || 'Failed to save job')
      setLoading(false)
    } else {
      router.push('/contractor/jobs/' + result.job.id)
    }
  }

  const inputStyle = {
    width: '100%', padding: '11px 14px', border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box',
    backgroundColor: 'white', color: contractorTheme.textBody,
  }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: contractorTheme.text }
  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = { fontSize: '16px', fontWeight: '600', color: contractorTheme.text, marginBottom: '20px', marginTop: 0, paddingBottom: '12px', borderBottom: '1px solid ' + contractorTheme.border }
  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }

  return (
    <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: '0 0 8px 0' }}>Start a new job</h1>
      <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '0 0 24px 0' }}>Tell us about the homeowner and property — we&apos;ll handle the rest</p>

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Homeowner</h2>
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
          <h2 style={sectionTitleStyle}>Property</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Property address *</label>
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
              <input style={inputStyle} name="property_zip" value={form.property_zip} onChange={handleChange} onBlur={handleAHJResolve} required />
            </div>
          </div>
          {ahjLoading && <p style={{ fontSize: '13px', color: '#64748b', marginTop: '12px' }}>Detecting AHJ...</p>}
          {detectedAHJ && !ahjLoading && (
            <p style={{ fontSize: '13px', marginTop: '12px', color: '#1d4ed8' }}>AHJ detected: <strong>{detectedAHJ.name}</strong></p>
          )}
          {!detectedAHJ && !ahjLoading && form.property_zip.length === 5 && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>Select AHJ manually</label>
              <select style={inputStyle} value={form.ahj_id} onChange={e => setForm(prev => ({ ...prev, ahj_id: e.target.value }))}>
                <option value="">Select AHJ</option>
                {allAHJs.map(ahj => <option key={ahj.id} value={ahj.id}>{ahj.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Job scope</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Scope of work</label>
            <textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} name="scope_of_work" value={form.scope_of_work} onChange={handleChange} />
          </div>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Roof type</label>
              <select style={inputStyle} name="roof_type" value={form.roof_type} onChange={handleChange}>
                <option value="">Select roof type</option>
                {['Shingle', 'Tile', 'Metal', 'Flat', 'Modified Bitumen'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Squares</label>
              <input style={inputStyle} type="number" name="squares" value={form.squares} onChange={handleChange} placeholder="e.g. 24" />
            </div>
            <div>
              <label style={labelStyle}>Valuation ($)</label>
              <input style={inputStyle} type="number" name="valuation" value={form.valuation} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Product approval</h2>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Manufacturer</label>
              <select style={inputStyle} value={primaryMaterial.manufacturer}
                onChange={e => setPrimaryMaterial({ manufacturer: e.target.value, product_name: '', approval_number: '' })}>
                <option value="">Select manufacturer</option>
                {getManufacturers().map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Product</label>
              <select style={inputStyle} value={primaryMaterial.product_name} disabled={!primaryMaterial.manufacturer}
                onChange={e => {
                  const match = products.find(p => p.layer_type === 'primary' && p.manufacturer === primaryMaterial.manufacturer && p.product_name === e.target.value)
                  setPrimaryMaterial({ ...primaryMaterial, product_name: e.target.value, approval_number: match?.approval_number || '' })
                }}>
                <option value="">Select product</option>
                {getProducts(primaryMaterial.manufacturer).map(p => <option key={p.id} value={p.product_name}>{p.product_name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>FL approval #</label>
              <input style={inputStyle} value={primaryMaterial.approval_number}
                onChange={e => setPrimaryMaterial({ ...primaryMaterial, approval_number: e.target.value })} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Notes</h2>
          <textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} name="notes" value={form.notes} onChange={handleChange} placeholder="Internal notes..." />
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '48px' }}>
          <button type="button" onClick={() => router.push('/contractor/dashboard')}
            style={{ padding: '12px 24px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: 'white', fontSize: '14px', cursor: 'pointer', color: '#475569' }}>
            Cancel
          </button>
          <button type="submit" disabled={loading}
            style={{ padding: '12px 24px', background: loading ? '#94a3b8' : 'linear-gradient(135deg, #0284c7, #059669)', color: 'white', border: 'none', borderRadius: '999px', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
            {loading ? 'Submitting...' : 'Submit job'}
          </button>
        </div>
      </form>
    </div>
  )
}
