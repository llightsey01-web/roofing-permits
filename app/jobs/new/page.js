'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'

const emptyMaterial = { manufacturer: '', product_name: '', approval_number: '' }

export default function NewJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showVentilation, setShowVentilation] = useState(false)
  const [products, setProducts] = useState([])
  const [detectedAHJ, setDetectedAHJ] = useState(null)
  const [ahjLoading, setAhjLoading] = useState(false)
  const [allAHJs, setAllAHJs] = useState([])
  const [companyId, setCompanyId] = useState(null)

  const [form, setForm] = useState({
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    property_address: '',
    property_city: '',
    property_state: 'FL',
    property_zip: '',
    property_type: 'Residential',
    scope_of_work: '',
    roof_type: '',
    valuation: '',
    internal_notes: '',
    ahj_id: '',
    job_specs: {
      gate_code: '',
      cross_street: '',
    },
  })

  const [primaryMaterial, setPrimaryMaterial] = useState({ ...emptyMaterial })
  const [underlayment, setUnderlayment] = useState({ ...emptyMaterial })
  const [ventilation, setVentilation] = useState({ ...emptyMaterial })

  useEffect(() => {
    const supabase = createClient()

    // Get logged in user's company_id dynamically
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return }

      const { data: userData } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single()

      if (userData?.company_id) {
        setCompanyId(userData.company_id)
      }
    })

    supabase.from('product_approvals')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => setProducts(data || []))

    supabase.from('ahj_portals')
      .select('id, name, county_or_city')
      .eq('is_active', true)
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
    const { name, value } = e.target
    if (name.startsWith('job_specs.')) {
      const key = name.replace('job_specs.', '')
      setForm(prev => ({ ...prev, job_specs: { ...prev.job_specs, [key]: value } }))
    } else {
      setForm(prev => ({ ...prev, [name]: value }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!companyId) { setError('Company not found. Please contact support.'); return }
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    const payload = {
      ...form,
      ahj_id: form.ahj_id || null,
      valuation: form.valuation ? parseFloat(form.valuation) : null,
      company_id: companyId,
      roof_specs: {
        primary_material: primaryMaterial,
        underlayment: underlayment,
        ventilation: showVentilation ? ventilation : null,
      },
    }

    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Failed to save job')
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '14px', boxSizing: 'border-box',
    backgroundColor: 'white', color: '#0f172a',
  }

  const labelStyle = {
    display: 'block', fontSize: '13px',
    fontWeight: '500', marginBottom: '6px', color: '#475569',
  }

  const sectionStyle = {
    backgroundColor: 'white', border: '1px solid #e2e8f0',
    borderRadius: '12px', padding: '24px', marginBottom: '24px',
  }

  const sectionTitleStyle = {
    fontSize: '15px', fontWeight: '600', color: '#0f172a',
    marginBottom: '20px', marginTop: '0',
    paddingBottom: '12px', borderBottom: '1px solid #f1f5f9',
  }

  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }

  const subSectionStyle = {
    border: '1px solid #f1f5f9', borderRadius: '8px',
    padding: '16px', marginBottom: '16px', backgroundColor: '#fafafa',
  }

  const subLabelStyle = {
    fontSize: '11px', fontWeight: '600', color: '#94a3b8',
    marginBottom: '12px', marginTop: '0',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  }

  function MaterialLayer({ title, layerType, values, setter }) {
    const manufacturers = getManufacturers(layerType)
    const productList = getProducts(layerType, values.manufacturer)
    return (
      <div style={subSectionStyle}>
        <p style={subLabelStyle}>{title}</p>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Manufacturer</label>
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
            <label style={labelStyle}>Product name</label>
            <select
              style={{ ...inputStyle, backgroundColor: values.manufacturer ? 'white' : '#f9fafb' }}
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
              {values.approval_number && (
                <span style={{ marginLeft: '8px', fontSize: '11px', color: '#16a34a', fontWeight: '400' }}>auto-filled</span>
              )}
            </label>
            <input
              style={{ ...inputStyle, backgroundColor: values.approval_number ? '#f0fdf4' : 'white', borderColor: values.approval_number ? '#86efac' : '#e2e8f0' }}
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
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      <div style={{
        backgroundColor: '#0f172a', padding: '0 32px',
        display: 'flex', alignItems: 'center', gap: '16px', height: '60px',
      }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ fontSize: '14px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ← Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px', height: '24px', backgroundColor: '#3b82f6',
            borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'white', fontSize: '12px', fontWeight: '700' }}>A</span>
          </div>
          <span style={{ color: 'white', fontSize: '15px', fontWeight: '600' }}>AHJ-iQ</span>
        </div>
        <span style={{ color: '#475569', fontSize: '14px' }}>/ New permit application</span>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px' }}>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Homeowner information</h2>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Owner name</label>
              <input style={inputStyle} name="owner_name" value={form.owner_name} onChange={handleChange} required />
            </div>
            <div>
              <label style={labelStyle}>Owner phone</label>
              <input style={inputStyle} name="owner_phone" value={form.owner_phone} onChange={handleChange} placeholder="863-555-1234" required />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Owner email</label>
              <input style={inputStyle} type="email" name="owner_email" value={form.owner_email} onChange={handleChange} />
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '12px 0 0 0' }}>
            NOC will be automatically sent to the homeowner via text and email when this job is saved.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Property information</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Property address</label>
            <input style={inputStyle} name="property_address" value={form.property_address} onChange={handleChange} required />
          </div>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>City</label>
              <input style={inputStyle} name="property_city" value={form.property_city} onChange={handleChange} required />
            </div>
            <div>
              <label style={labelStyle}>Zip code</label>
              <input style={inputStyle} name="property_zip" value={form.property_zip} onChange={handleChange} onBlur={handleAHJResolve} required />
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            {ahjLoading && (
              <div style={{ fontSize: '13px', color: '#64748b', padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                Detecting AHJ...
              </div>
            )}
            {detectedAHJ && !ahjLoading && (
              <div style={{ fontSize: '13px', padding: '10px 14px', backgroundColor: '#f0fdf4', borderRadius: '8px', border: '1px solid #86efac', color: '#15803d' }}>
                AHJ detected: <strong>{detectedAHJ.name}</strong>
              </div>
            )}
            {!detectedAHJ && !ahjLoading && form.property_zip.length === 5 && (
              <div style={{ fontSize: '13px', color: '#64748b' }}>
                AHJ not auto-detected.{' '}
                <span style={{ color: '#374151', fontWeight: '500' }}>Select manually:</span>
                <select
                  style={{ ...inputStyle, marginTop: '8px' }}
                  value={form.ahj_id}
                  onChange={e => setForm(prev => ({ ...prev, ahj_id: e.target.value }))}
                >
                  <option value="">Select AHJ</option>
                  {allAHJs.map(ahj => <option key={ahj.id} value={ahj.id}>{ahj.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={{ marginTop: '16px' }}>
            <label style={labelStyle}>Property type</label>
            <select style={inputStyle} name="property_type" value={form.property_type} onChange={handleChange}>
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
              <option value="Multi-Family">Multi-Family</option>
            </select>
          </div>

          <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Gate code</label>
              <input style={inputStyle} name="job_specs.gate_code" value={form.job_specs.gate_code} onChange={handleChange} placeholder="If gated community" />
            </div>
            <div>
              <label style={labelStyle}>Nearest cross street</label>
              <input style={inputStyle} name="job_specs.cross_street" value={form.job_specs.cross_street} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Job scope</h2>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Scope of work</label>
            <textarea
              style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
              name="scope_of_work" value={form.scope_of_work} onChange={handleChange}
            />
          </div>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Roof type</label>
              <select style={inputStyle} name="roof_type" value={form.roof_type} onChange={handleChange}>
                <option value="">Select roof type</option>
                <option value="Shingle">Shingle</option>
                <option value="Tile">Tile</option>
                <option value="Metal">Metal</option>
                <option value="Flat">Flat</option>
                <option value="Modified Bitumen">Modified Bitumen</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Number of squares</label>
              <input style={inputStyle} type="number" name="job_specs.squares" value={form.job_specs.squares || ''} onChange={handleChange} placeholder="e.g. 24" />
            </div>
            <div>
              <label style={labelStyle}>Contract value ($)</label>
              <input style={inputStyle} type="number" name="valuation" value={form.valuation} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Materials and product approvals</h2>
          <MaterialLayer title="Primary material" layerType="primary" values={primaryMaterial} setter={setPrimaryMaterial} />
          <MaterialLayer title="Underlayment" layerType="underlayment" values={underlayment} setter={setUnderlayment} />
          {showVentilation ? (
            <div>
              <MaterialLayer title="Ventilation" layerType="ventilation" values={ventilation} setter={setVentilation} />
              <button
                type="button"
                onClick={() => { setShowVentilation(false); setVentilation({ ...emptyMaterial }) }}
                style={{ fontSize: '13px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0', marginBottom: '16px', display: 'block' }}
              >
                Remove ventilation
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowVentilation(true)}
              style={{ fontSize: '13px', color: '#2563eb', background: 'none', border: '1px dashed #93c5fd', borderRadius: '8px', cursor: 'pointer', padding: '10px 16px', width: '100%', textAlign: 'center' }}
            >
              + Add ventilation product
            </button>
          )}
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Internal notes</h2>
          <textarea
            style={{ ...inputStyle, height: '80px', resize: 'vertical' }}
            name="internal_notes" value={form.internal_notes} onChange={handleChange}
            placeholder="Any internal notes about this job..."
          />
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '48px' }}>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            style={{ padding: '12px 24px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: 'white', fontSize: '14px', cursor: 'pointer', color: '#475569' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px 24px', backgroundColor: loading ? '#94a3b8' : '#2563eb',
              color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '500',
            }}
          >
            {loading ? 'Saving...' : 'Save job'}
          </button>
        </div>
      </form>
    </div>
  )
}