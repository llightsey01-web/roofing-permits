'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase'

export default function AdminPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createSuccess, setCreateSuccess] = useState('')

  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    state: 'FL',
    zip: '',
    phone: '',
    primary_email: '',
    license_number: '',
    qualifier_name: '',
    qualifier_license: '',
    contact_first_name: '',
    contact_last_name: '',
    contact_email: '',
  })

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Check admin role
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!userData || userData.role !== 'super_admin') {
        router.push('/dashboard')
        return
      }

      setUser(user)
      loadCompanies(supabase)
    }
    init()
  }, [])

  async function loadCompanies(supabase) {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false })
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
      // Step 1 — Create company record
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
          name: form.name,
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
          phone: form.phone,
          primary_email: form.primary_email,
          license_number: form.license_number,
          qualifier_name: form.qualifier_name,
          qualifier_license: form.qualifier_license,
          is_active: true,
        })
        .select()
        .single()

      if (companyError) throw new Error('Failed to create company: ' + companyError.message)

      // Step 2 — Invite user via Supabase Auth
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

      // Step 3 — Create user record
      await supabase.from('users').insert({
        id: inviteData.user.id,
        company_id: company.id,
        role: 'company_admin',
        email: form.contact_email,
        full_name: form.contact_first_name + ' ' + form.contact_last_name,
      })

      // Step 4 — Link company to owner
      await supabase.from('companies')
        .update({ owner_user_id: inviteData.user.id })
        .eq('id', company.id)

      setCreateSuccess(`Company created and invite sent to ${form.contact_email}`)
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

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8' }}>Loading...</p>
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

  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>

      {/* Header */}
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
          <span style={{ color: '#475569', fontSize: '14px' }}>/ Admin</span>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button onClick={() => router.push('/dashboard')}
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Dashboard
          </button>
          <button onClick={() => router.push('/settings')}
            style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Settings
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1100px', margin: '32px auto', padding: '0 32px' }}>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Admin Panel</h1>
            <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>
              Manage roofing companies and their accounts
            </p>
          </div>
          <button
            onClick={() => { setShowNewCompany(true); setCreateError(''); setCreateSuccess('') }}
            style={{
              padding: '10px 20px', backgroundColor: '#2563eb',
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '14px', fontWeight: '500', cursor: 'pointer',
            }}
          >
            + Add roofing company
          </button>
        </div>

        {/* Success message */}
        {createSuccess && (
          <div style={{
            padding: '16px 20px', backgroundColor: '#f0fdf4',
            border: '1px solid #86efac', borderRadius: '10px',
            marginBottom: '24px', fontSize: '14px', color: '#15803d',
          }}>
            {createSuccess}
          </div>
        )}

        {/* New company form */}
        {showNewCompany && (
          <div style={{
            backgroundColor: 'white', border: '1px solid #e2e8f0',
            borderRadius: '12px', padding: '28px', marginBottom: '24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                New Roofing Company
              </h2>
              <button
                onClick={() => setShowNewCompany(false)}
                style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateCompany}>

              <p style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px 0' }}>
                Company information
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Company name</label>
                <input style={inputStyle} name="name" value={form.name} onChange={handleChange} required />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Business address</label>
                <input style={inputStyle} name="address" value={form.address} onChange={handleChange} required />
              </div>

              <div style={{ ...grid2, marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>City</label>
                  <input style={inputStyle} name="city" value={form.city} onChange={handleChange} required />
                </div>
                <div>
                  <label style={labelStyle}>Zip</label>
                  <input style={inputStyle} name="zip" value={form.zip} onChange={handleChange} required />
                </div>
                <div>
                  <label style={labelStyle}>Phone</label>
                  <input style={inputStyle} name="phone" value={form.phone} onChange={handleChange} required />
                </div>
                <div>
                  <label style={labelStyle}>Company email</label>
                  <input style={inputStyle} type="email" name="primary_email" value={form.primary_email} onChange={handleChange} />
                </div>
              </div>

              <p style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '24px 0 16px 0' }}>
                License information
              </p>

              <div style={{ ...grid2, marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>Contractor license #</label>
                  <input style={inputStyle} name="license_number" value={form.license_number} onChange={handleChange} placeholder="CCC1234567" required />
                </div>
                <div>
                  <label style={labelStyle}>Qualifier name</label>
                  <input style={inputStyle} name="qualifier_name" value={form.qualifier_name} onChange={handleChange} required />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Qualifier license #</label>
                  <input style={inputStyle} name="qualifier_license" value={form.qualifier_license} onChange={handleChange} placeholder="CBC1234567" />
                </div>
              </div>

              <p style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '24px 0 16px 0' }}>
                Portal access — invite contact
              </p>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px 0' }}>
                This person will receive an email to set up their login and access the client portal.
              </p>

              <div style={{ ...grid2, marginBottom: '24px' }}>
                <div>
                  <label style={labelStyle}>First name</label>
                  <input style={inputStyle} name="contact_first_name" value={form.contact_first_name} onChange={handleChange} required />
                </div>
                <div>
                  <label style={labelStyle}>Last name</label>
                  <input style={inputStyle} name="contact_last_name" value={form.contact_last_name} onChange={handleChange} required />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Email address</label>
                  <input style={inputStyle} type="email" name="contact_email" value={form.contact_email} onChange={handleChange} required />
                </div>
              </div>

              {createError && (
                <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>{createError}</p>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewCompany(false)}
                  style={{
                    padding: '10px 20px', border: '1px solid #e2e8f0',
                    borderRadius: '8px', backgroundColor: 'white',
                    fontSize: '14px', cursor: 'pointer', color: '#475569',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: creating ? '#94a3b8' : '#2563eb',
                    color: 'white', border: 'none', borderRadius: '8px',
                    fontSize: '14px', fontWeight: '500',
                    cursor: creating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {creating ? 'Creating...' : 'Create company and send invite'}
                </button>
              </div>

            </form>
          </div>
        )}

        {/* Companies list */}
        <div style={{
          backgroundColor: 'white', border: '1px solid #e2e8f0',
          borderRadius: '12px', overflow: 'hidden',
        }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
              Roofing Companies ({companies.length})
            </h2>
          </div>

          {companies.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <p style={{ fontSize: '32px', margin: '0 0 12px 0' }}>🏗️</p>
              <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>
                No companies yet. Add your first roofing company above.
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['Company', 'Location', 'License', 'Qualifier', 'Status', 'Created'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left',
                      fontSize: '12px', fontWeight: '600',
                      color: '#64748b', letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((company, i) => (
                  <tr
                    key={company.id}
                    style={{ borderBottom: i < companies.length - 1 ? '1px solid #f1f5f9' : 'none' }}
                  >
                    <td style={{ padding: '16px' }}>
                      <p style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                        {company.name}
                      </p>
                      <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>
                        {company.primary_email}
                      </p>
                    </td>
                    <td style={{ padding: '16px', fontSize: '14px', color: '#475569' }}>
                      {company.city}, {company.state} {company.zip}
                    </td>
                    <td style={{ padding: '16px', fontSize: '13px', color: '#475569', fontFamily: 'monospace' }}>
                      {company.license_number || '—'}
                    </td>
                    <td style={{ padding: '16px', fontSize: '14px', color: '#475569' }}>
                      {company.qualifier_name || '—'}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        fontSize: '12px', fontWeight: '500',
                        padding: '3px 8px', borderRadius: '20px',
                        backgroundColor: company.is_active ? '#dcfce7' : '#fee2e2',
                        color: company.is_active ? '#15803d' : '#b91c1c',
                      }}>
                        {company.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', fontSize: '13px', color: '#94a3b8' }}>
                      {new Date(company.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}