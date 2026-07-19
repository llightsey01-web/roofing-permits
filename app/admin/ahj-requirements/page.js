'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { adminTheme, adminPanelStyle } from '../../../lib/ui/admin-theme'

const emptyDocForm = {
  name: '',
  description: '',
  is_required: true,
  sequence_order: 0,
  when_needed: 'at_permit',
  download_url: '',
  notes: '',
}

const emptyInspForm = {
  inspection_name: '',
  description: '',
  sequence_order: 0,
  when_to_schedule: '',
  typical_wait_days: 2,
  notes: '',
}

export default function AdminAhjRequirementsPage() {
  const router = useRouter()
  const [ahjs, setAhjs] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [portal, setPortal] = useState({
    office_address: '',
    phone: '',
    email: '',
    office_hours: '',
    avg_approval_days: '',
    submission_method: 'portal',
    portal_tips: '',
    portal_url: '',
  })

  const [docs, setDocs] = useState([])
  const [inspections, setInspections] = useState([])
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [showAddInsp, setShowAddInsp] = useState(false)
  const [docForm, setDocForm] = useState(emptyDocForm)
  const [inspForm, setInspForm] = useState(emptyInspForm)
  const [editingDocId, setEditingDocId] = useState(null)
  const [editingInspId, setEditingInspId] = useState(null)
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [lastScrapedLabel, setLastScrapedLabel] = useState('never')

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace('/login')
      return null
    }
    return session.access_token
  }

  const loadScrapeStatus = useCallback(async function (accessToken) {
    try {
      const token = accessToken || (await getToken())
      if (!token) return
      const res = await fetch('/api/admin/scrape-ahj-forms', {
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await res.json()
      if (res.ok) {
        setLastScrapedLabel(data.lastScrapedLabel || 'never')
      }
    } catch {
      // keep previous
    }
  }, [router])

  const loadAhjs = useCallback(async function () {
    try {
      const res = await fetch('/api/contractor/ahj-guide', {
        cache: 'no-store',
        headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load AHJs')
      const list = data.ahjs || []
      setAhjs(list)
      setSelectedId(function (prev) {
        if (prev && list.some(function (a) { return a.id === prev })) return prev
        return list[0]?.id || ''
      })
      setError('')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [])

  useEffect(function () {
    loadAhjs()
    loadScrapeStatus()
  }, [loadAhjs, loadScrapeStatus])

  async function triggerScrape() {
    if (scrapeBusy) return
    if (!window.confirm('Start AHJ forms scrape for all FL counties? This may take a while.')) {
      return
    }
    setScrapeBusy(true)
    setMessage('')
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/scrape-ahj-forms', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start scrape')
      setMessage(data.message || 'Scrape started')
      setLastScrapedLabel('running…')
    } catch (err) {
      setError(err.message)
    }
    setScrapeBusy(false)
  }

  useEffect(function () {
    const ahj = ahjs.find(function (a) { return a.id === selectedId })
    if (!ahj) return
    setPortal({
      office_address: ahj.office_address || '',
      phone: ahj.phone || '',
      email: ahj.email || '',
      office_hours: ahj.office_hours || '',
      avg_approval_days: ahj.avg_approval_days != null ? String(ahj.avg_approval_days) : '',
      submission_method: ahj.submission_method || 'portal',
      portal_tips: ahj.portal_tips || '',
      portal_url: ahj.portal_url || '',
    })
    setDocs(ahj.documents || ahj.requirements || [])
    setInspections(ahj.inspections || [])
    setShowAddDoc(false)
    setShowAddInsp(false)
    setEditingDocId(null)
    setEditingInspId(null)
    setDocForm(emptyDocForm)
    setInspForm(emptyInspForm)
  }, [selectedId, ahjs])

  async function savePortal() {
    if (!selectedId) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-portals/' + selectedId, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          office_address: portal.office_address || null,
          phone: portal.phone || null,
          email: portal.email || null,
          office_hours: portal.office_hours || null,
          avg_approval_days: portal.avg_approval_days === '' ? null : Number(portal.avg_approval_days),
          submission_method: portal.submission_method || null,
          portal_tips: portal.portal_tips || null,
          portal_url: portal.portal_url || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save portal info')
      setMessage('Portal info saved.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function addDocument() {
    if (!selectedId || !docForm.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-requirements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          ahj_id: selectedId,
          requirement_type: 'document',
          ...docForm,
          sequence_order: Number(docForm.sequence_order) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add document')
      setShowAddDoc(false)
      setDocForm(emptyDocForm)
      setMessage('Document added.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function saveDocument(doc) {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const token = await getToken()
      if (!token) return
      const payload = {
        name: doc.name,
        description: doc.description,
        is_required: doc.is_required,
        sequence_order: doc.sequence_order,
        when_needed: doc.when_needed,
        download_url: doc.download_url,
        notes: doc.notes,
        is_active: doc.is_active !== false,
        requirement_type: doc.requirement_type || 'document',
      }
      const res = await fetch('/api/admin/ahj-requirements/' + doc.id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to update document')
      }
      setEditingDocId(null)
      setMessage('Requirement updated — changes are live on contractor portal')
      await loadAhjs()
      setTimeout(function () { setMessage('') }, 3000)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function deleteDocument(id) {
    if (!window.confirm('Delete this document requirement?')) return
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-requirements/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setMessage('Document deleted.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function addInspection() {
    if (!selectedId || !inspForm.inspection_name.trim()) return
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-inspections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          ahj_id: selectedId,
          ...inspForm,
          sequence_order: Number(inspForm.sequence_order) || 0,
          typical_wait_days:
            inspForm.typical_wait_days === '' ? null : Number(inspForm.typical_wait_days),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add inspection')
      setShowAddInsp(false)
      setInspForm(emptyInspForm)
      setMessage('Inspection added.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function saveInspection(insp) {
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-inspections/' + insp.id, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(insp),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update inspection')
      setEditingInspId(null)
      setMessage('Inspection updated.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function deleteInspection(id) {
    if (!window.confirm('Delete this inspection?')) return
    setSaving(true)
    setError('')
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch('/api/admin/ahj-inspections/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setMessage('Inspection deleted.')
      await loadAhjs()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid ' + adminTheme.border,
    backgroundColor: adminTheme.surfaceRaised,
    color: adminTheme.text,
    fontSize: '13px',
  }

  const labelStyle = {
    display: 'block',
    marginBottom: '4px',
    fontSize: '11px',
    letterSpacing: '0.06em',
    color: adminTheme.textMuted,
    textTransform: 'uppercase',
  }

  const btnPrimary = {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: adminTheme.accentStrong,
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: saving ? 'wait' : 'pointer',
    opacity: saving ? 0.7 : 1,
  }

  const btnGhost = {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid ' + adminTheme.border,
    backgroundColor: 'transparent',
    color: adminTheme.textMuted,
    fontSize: '12px',
    cursor: 'pointer',
  }

  const btnDanger = {
    ...btnGhost,
    color: adminTheme.danger,
    borderColor: 'rgba(248,113,113,0.4)',
  }

  if (loading) {
    return (
      <div style={{ color: adminTheme.textMuted, padding: '24px' }}>Loading AHJs…</div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h1 style={{
        margin: '0 0 6px',
        fontSize: '22px',
        letterSpacing: '0.04em',
        color: adminTheme.text,
      }}>
        MANAGE AHJ REQUIREMENTS
      </h1>
      <p style={{ margin: '0 0 16px', color: adminTheme.textMuted, fontSize: '13px' }}>
        Edit portal info, required documents, and inspection schedules per county.
      </p>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px',
      }}>
        <button
          type="button"
          style={btnPrimary}
          onClick={triggerScrape}
          disabled={scrapeBusy || saving}
        >
          {scrapeBusy ? 'Starting…' : '🔄 Scrape AHJ Forms'}
        </button>
        <span style={{ color: adminTheme.textDim, fontSize: '12px' }}>
          Last scraped: {lastScrapedLabel}
        </span>
      </div>

      {message && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(52,211,153,0.12)',
          color: adminTheme.success,
          fontSize: '13px',
        }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(248,113,113,0.12)',
          color: adminTheme.danger,
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: '20px', maxWidth: '420px' }}>
        <label style={labelStyle}>Select County</label>
        <select
          value={selectedId}
          onChange={function (e) { setSelectedId(e.target.value) }}
          style={inputStyle}
        >
          {ahjs.map(function (a) {
            return (
              <option key={a.id} value={a.id}>
                {a.county_or_city} — {a.name}
              </option>
            )
          })}
        </select>
      </div>

      {/* Portal Info */}
      <div style={{ ...adminPanelStyle(), marginBottom: '20px' }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid ' + adminTheme.border,
          fontSize: '12px',
          letterSpacing: '0.08em',
          color: adminTheme.textMuted,
          fontWeight: 700,
        }}>
          PORTAL INFO
        </div>
        <div style={{
          padding: '16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
        }}>
          <div>
            <label style={labelStyle}>Office Address</label>
            <input
              style={inputStyle}
              value={portal.office_address}
              onChange={function (e) { setPortal({ ...portal, office_address: e.target.value }) }}
            />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              style={inputStyle}
              value={portal.phone}
              onChange={function (e) { setPortal({ ...portal, phone: e.target.value }) }}
            />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              value={portal.email}
              onChange={function (e) { setPortal({ ...portal, email: e.target.value }) }}
            />
          </div>
          <div>
            <label style={labelStyle}>Office Hours</label>
            <input
              style={inputStyle}
              value={portal.office_hours}
              onChange={function (e) { setPortal({ ...portal, office_hours: e.target.value }) }}
            />
          </div>
          <div>
            <label style={labelStyle}>Avg Approval Days</label>
            <input
              type="number"
              style={inputStyle}
              value={portal.avg_approval_days}
              onChange={function (e) { setPortal({ ...portal, avg_approval_days: e.target.value }) }}
            />
          </div>
          <div>
            <label style={labelStyle}>Submission</label>
            <select
              style={inputStyle}
              value={portal.submission_method}
              onChange={function (e) { setPortal({ ...portal, submission_method: e.target.value }) }}
            >
              <option value="portal">Portal</option>
              <option value="in_person">In Person</option>
              <option value="email">Email</option>
              <option value="mail">Mail</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Portal URL</label>
            <input
              style={inputStyle}
              value={portal.portal_url}
              onChange={function (e) { setPortal({ ...portal, portal_url: e.target.value }) }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Portal Tips</label>
            <textarea
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              value={portal.portal_tips}
              onChange={function (e) { setPortal({ ...portal, portal_tips: e.target.value }) }}
            />
          </div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <button type="button" style={btnPrimary} onClick={savePortal} disabled={saving}>
            Save Portal Info
          </button>
        </div>
      </div>

      {/* Documents */}
      <div style={{ ...adminPanelStyle(), marginBottom: '20px' }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid ' + adminTheme.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <span style={{
            fontSize: '12px',
            letterSpacing: '0.08em',
            color: adminTheme.textMuted,
            fontWeight: 700,
          }}>
            REQUIRED DOCUMENTS
          </span>
          <button
            type="button"
            style={btnGhost}
            onClick={function () {
              setShowAddDoc(true)
              setDocForm({
                ...emptyDocForm,
                sequence_order: docs.length + 1,
              })
            }}
          >
            + Add Document
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ color: adminTheme.textDim, textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Required</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>When</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Download URL</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Notes</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }} />
              </tr>
            </thead>
            <tbody>
              {docs.map(function (doc) {
                const editing = editingDocId === doc.id
                return (
                  <tr key={doc.id} style={{ borderTop: '1px solid ' + adminTheme.border }}>
                    <td style={{ padding: '10px 12px', color: adminTheme.text, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={doc.name}
                          onChange={function (e) {
                            setDocs(docs.map(function (d) {
                              return d.id === doc.id ? { ...d, name: e.target.value } : d
                            }))
                          }}
                        />
                      ) : doc.name}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          type="checkbox"
                          checked={Boolean(doc.is_required)}
                          onChange={function (e) {
                            setDocs(docs.map(function (d) {
                              return d.id === doc.id ? { ...d, is_required: e.target.checked } : d
                            }))
                          }}
                        />
                      ) : doc.is_required ? 'Yes' : 'No'}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={doc.when_needed || ''}
                          onChange={function (e) {
                            setDocs(docs.map(function (d) {
                              return d.id === doc.id ? { ...d, when_needed: e.target.value } : d
                            }))
                          }}
                        />
                      ) : (doc.when_needed || '—')}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top', maxWidth: '180px' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={doc.download_url || ''}
                          onChange={function (e) {
                            setDocs(docs.map(function (d) {
                              return d.id === doc.id ? { ...d, download_url: e.target.value } : d
                            }))
                          }}
                        />
                      ) : (
                        <span style={{ wordBreak: 'break-all' }}>{doc.download_url || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top', maxWidth: '200px' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={doc.notes || ''}
                          onChange={function (e) {
                            setDocs(docs.map(function (d) {
                              return d.id === doc.id ? { ...d, notes: e.target.value } : d
                            }))
                          }}
                        />
                      ) : (doc.notes || '—')}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {editing ? (
                        <>
                          <button type="button" style={{ ...btnGhost, marginRight: '6px' }} onClick={function () { saveDocument(doc) }}>
                            Save
                          </button>
                          <button type="button" style={btnGhost} onClick={function () { setEditingDocId(null); loadAhjs() }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" style={{ ...btnGhost, marginRight: '6px' }} onClick={function () { setEditingDocId(doc.id) }}>
                            Edit
                          </button>
                          <button type="button" style={btnDanger} onClick={function () { deleteDocument(doc.id) }}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '16px', color: adminTheme.textDim }}>
                    No documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showAddDoc && (
          <div style={{
            padding: '16px',
            borderTop: '1px solid ' + adminTheme.border,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
          }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input
                style={inputStyle}
                value={docForm.name}
                onChange={function (e) { setDocForm({ ...docForm, name: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>When</label>
              <input
                style={inputStyle}
                value={docForm.when_needed}
                onChange={function (e) { setDocForm({ ...docForm, when_needed: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Download URL</label>
              <input
                style={inputStyle}
                value={docForm.download_url}
                onChange={function (e) { setDocForm({ ...docForm, download_url: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <input
                style={inputStyle}
                value={docForm.notes}
                onChange={function (e) { setDocForm({ ...docForm, notes: e.target.value }) }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <input
                style={inputStyle}
                value={docForm.description}
                onChange={function (e) { setDocForm({ ...docForm, description: e.target.value }) }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={docForm.is_required}
                onChange={function (e) { setDocForm({ ...docForm, is_required: e.target.checked }) }}
              />
              <span style={{ color: adminTheme.textMuted, fontSize: '13px' }}>Required</span>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px' }}>
              <button type="button" style={btnPrimary} onClick={addDocument} disabled={saving}>
                Add Document
              </button>
              <button type="button" style={btnGhost} onClick={function () { setShowAddDoc(false) }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Inspections */}
      <div style={{ ...adminPanelStyle() }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid ' + adminTheme.border,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <span style={{
            fontSize: '12px',
            letterSpacing: '0.08em',
            color: adminTheme.textMuted,
            fontWeight: 700,
          }}>
            INSPECTION SCHEDULE
          </span>
          <button
            type="button"
            style={btnGhost}
            onClick={function () {
              setShowAddInsp(true)
              setInspForm({
                ...emptyInspForm,
                sequence_order: inspections.length + 1,
              })
            }}
          >
            + Add Inspection
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ color: adminTheme.textDim, textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Order</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>When to Schedule</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Wait Days</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }}>Notes</th>
                <th style={{ padding: '10px 12px', fontWeight: 500 }} />
              </tr>
            </thead>
            <tbody>
              {inspections.map(function (insp) {
                const editing = editingInspId === insp.id
                return (
                  <tr key={insp.id} style={{ borderTop: '1px solid ' + adminTheme.border }}>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top', width: '70px' }}>
                      {editing ? (
                        <input
                          type="number"
                          style={inputStyle}
                          value={insp.sequence_order}
                          onChange={function (e) {
                            setInspections(inspections.map(function (i) {
                              return i.id === insp.id
                                ? { ...i, sequence_order: Number(e.target.value) || 0 }
                                : i
                            }))
                          }}
                        />
                      ) : insp.sequence_order}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.text, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={insp.inspection_name}
                          onChange={function (e) {
                            setInspections(inspections.map(function (i) {
                              return i.id === insp.id
                                ? { ...i, inspection_name: e.target.value }
                                : i
                            }))
                          }}
                        />
                      ) : insp.inspection_name}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={insp.when_to_schedule || ''}
                          onChange={function (e) {
                            setInspections(inspections.map(function (i) {
                              return i.id === insp.id
                                ? { ...i, when_to_schedule: e.target.value }
                                : i
                            }))
                          }}
                        />
                      ) : (insp.when_to_schedule || '—')}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top', width: '90px' }}>
                      {editing ? (
                        <input
                          type="number"
                          style={inputStyle}
                          value={insp.typical_wait_days ?? ''}
                          onChange={function (e) {
                            setInspections(inspections.map(function (i) {
                              return i.id === insp.id
                                ? { ...i, typical_wait_days: e.target.value === '' ? null : Number(e.target.value) }
                                : i
                            }))
                          }}
                        />
                      ) : (insp.typical_wait_days ?? '—')}
                    </td>
                    <td style={{ padding: '10px 12px', color: adminTheme.textMuted, verticalAlign: 'top' }}>
                      {editing ? (
                        <input
                          style={inputStyle}
                          value={insp.notes || ''}
                          onChange={function (e) {
                            setInspections(inspections.map(function (i) {
                              return i.id === insp.id ? { ...i, notes: e.target.value } : i
                            }))
                          }}
                        />
                      ) : (insp.notes || '—')}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {editing ? (
                        <>
                          <button type="button" style={{ ...btnGhost, marginRight: '6px' }} onClick={function () { saveInspection(insp) }}>
                            Save
                          </button>
                          <button type="button" style={btnGhost} onClick={function () { setEditingInspId(null); loadAhjs() }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" style={{ ...btnGhost, marginRight: '6px' }} onClick={function () { setEditingInspId(insp.id) }}>
                            Edit
                          </button>
                          <button type="button" style={btnDanger} onClick={function () { deleteInspection(insp.id) }}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {inspections.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '16px', color: adminTheme.textDim }}>
                    No inspections yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showAddInsp && (
          <div style={{
            padding: '16px',
            borderTop: '1px solid ' + adminTheme.border,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '10px',
          }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input
                style={inputStyle}
                value={inspForm.inspection_name}
                onChange={function (e) { setInspForm({ ...inspForm, inspection_name: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>When to Schedule</label>
              <input
                style={inputStyle}
                value={inspForm.when_to_schedule}
                onChange={function (e) { setInspForm({ ...inspForm, when_to_schedule: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Wait Days</label>
              <input
                type="number"
                style={inputStyle}
                value={inspForm.typical_wait_days}
                onChange={function (e) { setInspForm({ ...inspForm, typical_wait_days: e.target.value }) }}
              />
            </div>
            <div>
              <label style={labelStyle}>Order</label>
              <input
                type="number"
                style={inputStyle}
                value={inspForm.sequence_order}
                onChange={function (e) { setInspForm({ ...inspForm, sequence_order: e.target.value }) }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notes</label>
              <input
                style={inputStyle}
                value={inspForm.notes}
                onChange={function (e) { setInspForm({ ...inspForm, notes: e.target.value }) }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px' }}>
              <button type="button" style={btnPrimary} onClick={addInspection} disabled={saving}>
                Add Inspection
              </button>
              <button type="button" style={btnGhost} onClick={function () { setShowAddInsp(false) }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
