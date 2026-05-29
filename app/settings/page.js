'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [companyId, setCompanyId] = useState(null)
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(null)

  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    state: 'FL',
    zip: '',
    phone: '',
    primary_email: '',
    license_number: '',
    qualifer_name: '',
    qualifer_license: '',
  })

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      loadCompany(supabase)
    }
    init()
  }, [])

  async function loadCompany(supabase) {
    const { data: companies } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .limit(1)

    if (companies && companies.length > 0) {
      const company = companies[0]
      setCompanyId(company.id)
      setForm({
        name: company.name || '',
        address: company.address || '',
        city: company.city || '',
        state: company.state || 'FL',
        zip: company.zip || '',
        phone: company.phone || '',
        primary_email: company.primary_email || '',
        license_number: company.license_number || '',
        qualifer_name: company.qualifer_name || '',
        qualifer_license: company.qualifer_license || '',
      })

      const { data: docs } = await supabase
        .from('job_documents')
        .select('*')
        .eq('job_id', company.id)
      setDocuments(docs || [])
    }
    setLoading(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!companyId) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('companies').update({
      name: form.name,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
      phone: form.phone,
      primary_email: form.primary_email,
      license_number: form.license_number,
      qualifer_name: form.qualifer_name,
      qualifer_license: form.qualifer_license,
      updated_at: new Date().toISOString(),
    }).eq('id', companyId)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function handleFileUpload(e, docType) {
    const file = e.target.files[0]
    if (!file || !companyId) return
    setUploading(docType)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const filePath = 'companies/' + companyId + '/' + docType + '/' + file.name
    const { error } = await supabase.storage
      .from('job-documents').upload(filePath, file, { upsert: true })
    if (!error) {
      await supabase.from('job_documents').insert({
        job_id: companyId,
        document_type: docType,
        file_name: file.name,
        file_path: filePath,
        file_size_bytes: file.size,
        mime_type: file.type,
        uploaded_by: user.id,
      })
      const { data: docs } = await supabase
        .from('job_documents').select('*').eq('job_id', companyId)
      setDocuments(docs || [])
    }
    setUploading(null)
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const companyDocs = [
    { key: 'contractor_license',   label: 'Contractor license',        required: true },
    { key: 'qualifier_license',    label: 'Qualifier license',          required: true },
    { key: 'gl_certificate',       label: 'General liability COI',      required: true },
    { key: 'wc_certificate',       label: "Workers' comp COI",          required: true },
    { key: 'contractor_signature', label: 'Contractor signature image', required: false },
  ]

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#64748b' }}>Loading...</p>
    </div>
  )

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

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>

      <div style={{
        backgroundColor: '#0f172a', padding: '0 32px',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '28px', height: '28px', backgroundColor: '#3b82f6',
            borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'white', fontSize: '14px', fontWeight: '700' }}>A</span>
          </div>
          <span style={{ color: 'white', fontSize: '16px', fontWeight: '600' }}>AHJ-iQ</span>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button onClick={() => router.push('/dashboard')}
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Dashboard
          </button>
          <button style={{ color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            Settings
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 32px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Company Settings</h1>
            <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>
              This info auto-fills on every permit application and NOC
            </p>
          </div>
          {saved && (
            <div style={{ padding: '8px 16px', backgroundColor: '#dcfce7', borderRadius: '8px', fontSize: '13px', color: '#15803d', fontWeight: '500' }}>
              Saved successfully
            </div>
          )}
        </div>

        <form onSubmit={handleSave}>

          <div style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Company information</h2>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Company name</label>
              <input style={inputStyle} name="name" value={form.name} onChange={handleChange} required />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Business address</label>
              <input style={inputStyle} name="address" value={form.address} onChange={handleChange} required />
            </div>
            <div style={grid2}>
              <div>
                <label style={labelStyle}>City</label>
                <input style={inputStyle} name="city" value={form.city} onChange={handleChange} required />
              </div>
              <div>
                <label style={labelStyle}>Zip code</label>
                <input style={inputStyle} name="zip" value={form.zip} onChange={handleChange} required />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input style={inputStyle} name="phone" value={form.phone} onChange={handleChange} required />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input style={inputStyle} type="email" name="primary_email" value={form.primary_email} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <h2 style={sectionTitleStyle}>License information</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px 0' }}>
              Auto-fills on every permit application submitted through AHJ-iQ.
            </p>
            <div style={grid2}>
              <div>
                <label style={labelStyle}>Contractor license number</label>
                <input style={inputStyle} name="license_number" value={form.license_number} onChange={handleChange} placeholder="CCC1234567" required />
              </div>
              <div>
                <label style={labelStyle}>Qualifier name</label>
                <input style={inputStyle} name="qualifer_name" value={form.qualifer_name} onChange={handleChange} placeholder="Full name" required />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Qualifier license number</label>
                <input style={inputStyle} name="qualifer_license" value={form.qualifer_license} onChange={handleChange} placeholder="CBC1234567" />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '12px 28px',
                backgroundColor: saving ? '#94a3b8' : '#2563eb',
                color: 'white', border: 'none', borderRadius: '8px',
                fontSize: '14px', fontWeight: '500',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save company info'}
            </button>
          </div>

        </form>

        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Company documents</h2>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>
            Upload once and these attach automatically to every permit packet.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {companyDocs.map(doc => {
              const uploaded = documents.find(d => d.document_type === doc.key)
              const isUploading = uploading === doc.key
              return (
                <div key={doc.key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: '10px',
                  backgroundColor: uploaded ? '#f0fdf4' : 'white',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      backgroundColor: uploaded ? '#dcfce7' : '#f1f5f9',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '16px',
                    }}>
                      {uploaded ? '✓' : '📄'}
                    </div>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: '500', margin: 0, color: uploaded ? '#15803d' : '#0f172a' }}>
                        {doc.label}
                        {doc.required && !uploaded && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginLeft: '6px' }}>Required</span>
                        )}
                      </p>
                      {uploaded && (
                        <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>{uploaded.file_name}</p>
                      )}
                    </div>
                  </div>
                  <label style={{
                    fontSize: '13px', padding: '7px 16px',
                    border: '1px solid #e2e8f0', borderRadius: '6px',
                    backgroundColor: 'white', cursor: 'pointer', color: '#475569', fontWeight: '500',
                  }}>
                    {isUploading ? 'Uploading...' : uploaded ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      onChange={e => handleFileUpload(e, doc.key)}
                      accept=".pdf,.jpg,.jpeg,.png"
                      disabled={isUploading}
                    />
                  </label>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}