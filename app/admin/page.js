'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../lib/ui/admin-theme'

export default function AdminPage() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createSuccess, setCreateSuccess] = useState('')

  const [form, setForm] = useState({
    name: '', address: '', city: '', state: 'FL', zip: '',
    phone: '', primary_email: '', license_number: '',
    qualifier_name: '', qualifier_license: '',
    contact_first_name: '', contact_last_name: '', contact_email: '',
  })

  useEffect(() => {
    loadCompanies(createClient())
  }, [])

  async function loadCompanies(supabase) {
    const { data } = await supabase.from('companies').select('*').order('created_at', { ascending: false })
    setCompanies(data || [])
    setLoading(false)
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleCreateCompany(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    setCreateSuccess('')
    const supabase = createClient()

    try {
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
          name: form.name, address: form.address, city: form.city,
          state: form.state, zip: form.zip, phone: form.phone,
          primary_email: form.primary_email, license_number: form.license_number,
          qualifier_name: form.qualifier_name, qualifier_license: form.qualifier_license,
          is_active: true,
        })
        .select()
        .single()

      if (companyError) throw new Error('Failed to create company: ' + companyError.message)

      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        form.contact_email,
        {
          data: {
            company_id: company.id,
            full_name: form.contact_first_name + ' ' + form.contact_last_name,
            role: 'company_admin',
          },
          redirectTo: 'https://roofing-permits-production.up.railway.app/dashboard',
        }
      )

      if (inviteError) throw new Error('Failed to send invite: ' + inviteError.message)

      await supabase.from('users').insert({
        id: inviteData.user.id,
        company_id: company.id,
        role: 'company_admin',
        email: form.contact_email,
        full_name: form.contact_first_name + ' ' + form.contact_last_name,
      })

      await supabase.from('companies').update({ owner_user_id: inviteData.user.id }).eq('id', company.id)

      setCreateSuccess('Company provisioned · invite dispatched to ' + form.contact_email)
      setForm({
        name: '', address: '', city: '', state: 'FL', zip: '',
        phone: '', primary_email: '', license_number: '',
        qualifier_name: '', qualifier_license: '',
        contact_first_name: '', contact_last_name: '', contact_email: '',
      })
      setShowNewCompany(false)
      loadCompanies(supabase)
    } catch (err) {
      setCreateError(err.message)
    }
    setCreating(false)
  }

  const inputStyle = {
    width: '100%', padding: '9px 11px',
    border: '1px solid ' + adminTheme.border,
    borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box',
    backgroundColor: adminTheme.surfaceRaised, color: adminTheme.text,
  }
  const labelStyle = {
    display: 'block', fontSize: '11px', fontWeight: '600',
    marginBottom: '5px', color: adminTheme.textMuted,
    fontFamily: adminTheme.fontMono, textTransform: 'uppercase', letterSpacing: '0.06em',
  }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '13px' }}>Loading registry...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: adminTheme.text, margin: 0 }}>Company Registry</h1>
          <p style={{ fontSize: '12px', color: adminTheme.textDim, margin: '4px 0 0 0', fontFamily: adminTheme.fontMono }}>
            Provision contractor tenants · portal access · license records
          </p>
        </div>
        <button
          onClick={() => { setShowNewCompany(true); setCreateError(''); setCreateSuccess('') }}
          style={{
            padding: '8px 14px', backgroundColor: adminTheme.accentStrong,
            color: 'white', border: 'none', borderRadius: '6px',
            fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: adminTheme.fontMono,
          }}
        >
          + Provision company
        </button>
      </div>

      {createSuccess && (
        <div style={{
          padding: '12px 16px', backgroundColor: '#064e3b',
          border: '1px solid #059669', borderRadius: '6px',
          marginBottom: '16px', fontSize: '12px', color: '#6ee7b7', fontFamily: adminTheme.fontMono,
        }}>
          {createSuccess}
        </div>
      )}

      {showNewCompany && (
        <div style={{ ...adminPanelStyle(), padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: '600', color: adminTheme.text, margin: 0, fontFamily: adminTheme.fontMono }}>
              NEW TENANT PROVISIONING
            </h2>
            <button onClick={() => setShowNewCompany(false)} style={{ color: adminTheme.textDim, background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
          </div>

          <form onSubmit={handleCreateCompany}>
            <p style={{ ...labelStyle, marginBottom: '12px' }}>Company record</p>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Company name</label>
              <input style={inputStyle} name="name" value={form.name} onChange={handleChange} required />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Business address</label>
              <input style={inputStyle} name="address" value={form.address} onChange={handleChange} required />
            </div>
            <div style={{ ...grid2, marginBottom: '14px' }}>
              <div><label style={labelStyle}>City</label><input style={inputStyle} name="city" value={form.city} onChange={handleChange} required /></div>
              <div><label style={labelStyle}>Zip</label><input style={inputStyle} name="zip" value={form.zip} onChange={handleChange} required /></div>
              <div><label style={labelStyle}>Phone</label><input style={inputStyle} name="phone" value={form.phone} onChange={handleChange} required /></div>
              <div><label style={labelStyle}>Company email</label><input style={inputStyle} type="email" name="primary_email" value={form.primary_email} onChange={handleChange} /></div>
            </div>

            <p style={{ ...labelStyle, margin: '20px 0 12px 0' }}>License metadata</p>
            <div style={{ ...grid2, marginBottom: '14px' }}>
              <div><label style={labelStyle}>Contractor license #</label><input style={inputStyle} name="license_number" value={form.license_number} onChange={handleChange} required /></div>
              <div><label style={labelStyle}>Qualifier name</label><input style={inputStyle} name="qualifier_name" value={form.qualifier_name} onChange={handleChange} required /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Qualifier license #</label><input style={inputStyle} name="qualifier_license" value={form.qualifier_license} onChange={handleChange} /></div>
            </div>

            <p style={{ ...labelStyle, margin: '20px 0 8px 0' }}>Portal operator invite</p>
            <p style={{ fontSize: '12px', color: adminTheme.textDim, margin: '0 0 14px 0' }}>
              Dispatches Contractor Portal credentials to the company admin contact.
            </p>
            <div style={{ ...grid2, marginBottom: '20px' }}>
              <div><label style={labelStyle}>First name</label><input style={inputStyle} name="contact_first_name" value={form.contact_first_name} onChange={handleChange} required /></div>
              <div><label style={labelStyle}>Last name</label><input style={inputStyle} name="contact_last_name" value={form.contact_last_name} onChange={handleChange} required /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Email</label><input style={inputStyle} type="email" name="contact_email" value={form.contact_email} onChange={handleChange} required /></div>
            </div>

            {createError && <p style={{ color: adminTheme.danger, fontSize: '12px', marginBottom: '12px', fontFamily: adminTheme.fontMono }}>{createError}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setShowNewCompany(false)} style={{
                padding: '8px 14px', border: '1px solid ' + adminTheme.border,
                borderRadius: '6px', backgroundColor: adminTheme.surface,
                fontSize: '12px', cursor: 'pointer', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono,
              }}>Cancel</button>
              <button type="submit" disabled={creating} style={{
                padding: '8px 14px', backgroundColor: creating ? adminTheme.textDim : adminTheme.accentStrong,
                color: 'white', border: 'none', borderRadius: '6px',
                fontSize: '12px', fontWeight: '600', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: adminTheme.fontMono,
              }}>
                {creating ? 'Provisioning...' : 'Create & dispatch invite'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={adminPanelStyle()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + adminTheme.border, backgroundColor: adminTheme.surfaceRaised }}>
          <h2 style={{ fontSize: '11px', fontWeight: '600', color: adminTheme.textMuted, margin: 0, fontFamily: adminTheme.fontMono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Active tenants ({companies.length})
          </h2>
        </div>

        {companies.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <p style={{ color: adminTheme.textDim, fontSize: '12px', fontFamily: adminTheme.fontMono, margin: 0 }}>
              No tenants provisioned · use &quot;Provision company&quot; to onboard a contractor
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + adminTheme.border }}>
                {['Company', 'Location', 'License', 'Qualifier', 'Status', 'Created'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '600',
                    color: adminTheme.textDim, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: adminTheme.fontMono,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((company, i) => (
                <tr key={company.id} style={{ borderBottom: i < companies.length - 1 ? '1px solid ' + adminTheme.borderSubtle : 'none' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: adminTheme.text, margin: 0 }}>{company.name}</p>
                    <p style={{ fontSize: '11px', color: adminTheme.textDim, margin: '2px 0 0 0' }}>{company.primary_email}</p>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{company.city}, {company.state}</td>
                  <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textMuted, fontFamily: adminTheme.fontMono }}>{company.license_number || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: adminTheme.textMuted }}>{company.qualifier_name || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', fontFamily: adminTheme.fontMono,
                      backgroundColor: company.is_active ? '#064e3b' : '#450a0a',
                      color: company.is_active ? '#6ee7b7' : '#fca5a5',
                    }}>
                      {company.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '11px', color: adminTheme.textDim, fontFamily: adminTheme.fontMono }}>
                    {new Date(company.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
