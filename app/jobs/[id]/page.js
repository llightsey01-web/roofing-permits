'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'

export default function JobDetailPage({ params }) {
  const router = useRouter()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [runningAutomation, setRunningAutomation] = useState(false)
  const [automationMessage, setAutomationMessage] = useState('')
  const [documents, setDocuments] = useState([])
  const [jobId, setJobId] = useState(null)

  useEffect(() => {
    async function init() {
      const resolvedParams = await params
      setJobId(resolvedParams.id)
      loadJob(resolvedParams.id)
    }
    init()
  }, [])

  async function loadJob(id) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: job } = await supabase
      .from('jobs').select('*').eq('id', id).single()

    const { data: docs } = await supabase
      .from('job_documents').select('*').eq('job_id', id)
      .order('uploaded_at', { ascending: false })

    setJob(job)
    setDocuments(docs || [])
    setLoading(false)
  }

  async function handleFileUpload(e, documentType) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const filePath = `jobs/${jobId}/${documentType}/${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('job-documents').upload(filePath, file, { upsert: true })
    if (!uploadError) {
      await supabase.from('job_documents').insert({
        job_id: jobId, document_type: documentType,
        file_name: file.name, file_path: filePath,
        file_size_bytes: file.size, mime_type: file.type,
        uploaded_by: user.id,
      })
      await loadJob(jobId)
    }
    setUploading(false)
  }

  async function handleStatusChange(newStatus) {
    const supabase = createClient()
    await supabase.from('jobs').update({ job_status: newStatus }).eq('id', jobId)
    await loadJob(jobId)
  }

  async function handleRunAutomation() {
    setRunningAutomation(true)
    setAutomationMessage('')
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    const response = await fetch('/api/automation/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ jobId }),
    })

    const result = await response.json()

    if (response.ok) {
      setAutomationMessage('Automation started — the browser will open and fill the permit portal automatically.')
      await loadJob(jobId)
    } else {
      setAutomationMessage('Error: ' + result.error)
    }
    setRunningAutomation(false)
  }

  const statusColors = {
    draft:              { bg: '#f1f5f9', text: '#475569' },
    ready:              { bg: '#dbeafe', text: '#1d4ed8' },
    automation_running: { bg: '#fef3c7', text: '#b45309' },
    needs_review:       { bg: '#fef9c3', text: '#854d0e' },
    needs_correction:   { bg: '#fee2e2', text: '#b91c1c' },
    approved:           { bg: '#dcfce7', text: '#15803d' },
    submitted:          { bg: '#d1fae5', text: '#065f46' },
    permit_issued:      { bg: '#bbf7d0', text: '#14532d' },
    on_hold:            { bg: '#fee2e2', text: '#b91c1c' },
    cancelled:          { bg: '#f1f5f9', text: '#64748b' },
  }

  const documentTypes = [
    { key: 'contractor_license',     label: 'Contractor license' },
    { key: 'qualifier_license',      label: 'Qualifier license' },
    { key: 'insurance_certificate',  label: 'Insurance certificate' },
    { key: 'notice_of_commencement', label: 'Notice of commencement' },
    { key: 'owners_affidavit',       label: "Owner's affidavit" },
    { key: 'product_approval',       label: 'Product approval' },
    { key: 'site_plan',              label: 'Site plan' },
    { key: 'signed_contract',        label: 'Signed contract' },
  ]

  const nocStages = [
    { key: 'not_started',             label: 'Not started' },
    { key: 'generated',               label: 'NOC generated' },
    { key: 'queued_for_notarization', label: 'Sent to homeowner' },
    { key: 'sent_for_notarization',   label: 'Awaiting signature' },
    { key: 'signed',                  label: 'Signed' },
    { key: 'notarized',               label: 'Notarized' },
    { key: 'submitted_to_erecord',    label: 'Submitted to eRecord' },
    { key: 'recorded',                label: 'Recorded' },
  ]

  const permitStages = [
    { key: 'draft',              label: 'Draft' },
    { key: 'ready',              label: 'Ready' },
    { key: 'automation_running', label: 'Automation running' },
    { key: 'needs_review',       label: 'Ready for review' },
    { key: 'submitted',          label: 'Submitted' },
    { key: 'approved',           label: 'Approved' },
    { key: 'permit_issued',      label: 'Permit issued' },
  ]

  function getNocStageIndex(status) {
    const idx = nocStages.findIndex(s => s.key === status)
    return idx === -1 ? 0 : idx
  }

  function getPermitStageIndex(status) {
    const idx = permitStages.findIndex(s => s.key === status)
    return idx === -1 ? 0 : idx
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
      <p style={{ color: '#64748b' }}>Loading...</p>
    </div>
  )

  if (!job) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
      <p style={{ color: '#64748b' }}>Job not found.</p>
    </div>
  )

  const status = statusColors[job.job_status] || statusColors.draft
  const roofSpecs = job.roof_specs || {}
  const nocStatus = job.noc_status || 'not_started'
  const currentNocIndex = getNocStageIndex(nocStatus)
  const currentPermitIndex = getPermitStageIndex(job.job_status)

  const sectionStyle = {
    backgroundColor: 'white', border: '1px solid #e2e8f0',
    borderRadius: '12px', padding: '24px', marginBottom: '24px',
  }

  const sectionTitleStyle = {
    fontSize: '15px', fontWeight: '600', color: '#0f172a',
    marginBottom: '20px', marginTop: '0',
    paddingBottom: '12px', borderBottom: '1px solid #f1f5f9',
  }

  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }

  function Field({ label, value }) {
    return (
      <div>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 4px 0' }}>{label}</p>
        <p style={{ fontSize: '14px', color: '#0f172a', fontWeight: '500', margin: 0 }}>{value || '—'}</p>
      </div>
    )
  }

  function MaterialSection({ title, material }) {
    if (!material || !material.manufacturer) return null
    return (
      <div style={{
        border: '1px solid #f1f5f9', borderRadius: '8px',
        padding: '16px', marginBottom: '12px', backgroundColor: '#fafafa',
      }}>
        <p style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px 0' }}>
          {title}
        </p>
        <div style={gridStyle}>
          <Field label="Manufacturer" value={material.manufacturer} />
          <Field label="Product name" value={material.product_name} />
          <Field label="FL product approval #" value={material.approval_number} />
        </div>
      </div>
    )
  }

  function PipelineTracker({ stages, currentIndex, isError }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px' }}>
        {stages.map((stage, idx) => {
          const isComplete = !isError && idx < currentIndex
          const isCurrent = !isError && idx === currentIndex
          return (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '13px', fontWeight: '600',
                  backgroundColor: isComplete ? '#0f172a' : isCurrent ? '#2563eb' : '#f1f5f9',
                  color: isComplete || isCurrent ? 'white' : '#94a3b8',
                  border: isCurrent ? '2px solid #2563eb' : 'none',
                }}>
                  {isComplete ? '✓' : idx + 1}
                </div>
                <p style={{
                  fontSize: '11px', margin: 0, textAlign: 'center',
                  color: isComplete ? '#0f172a' : isCurrent ? '#2563eb' : '#94a3b8',
                  fontWeight: isCurrent ? '600' : '400',
                  maxWidth: '72px', lineHeight: '1.3',
                }}>
                  {stage.label}
                </p>
              </div>
              {idx < stages.length - 1 && (
                <div style={{
                  width: '28px', height: '2px', margin: '0 4px 20px 4px', flexShrink: 0,
                  backgroundColor: idx < currentIndex ? '#0f172a' : '#e2e8f0',
                }} />
              )}
            </div>
          )
        })}
        {isError && (
          <div style={{ marginLeft: '12px', padding: '4px 12px', backgroundColor: '#fee2e2', borderRadius: '20px', fontSize: '12px', color: '#b91c1c', fontWeight: '500' }}>
            Error — check logs
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>

      {/* Header */}
      <div style={{
        backgroundColor: '#0f172a', padding: '0 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ fontSize: '14px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ← Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '24px', height: '24px', backgroundColor: '#3b82f6', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontSize: '12px', fontWeight: '700' }}>A</span>
            </div>
            <span style={{ color: 'white', fontSize: '15px', fontWeight: '600' }}>AHJ-iQ</span>
          </div>
          <span style={{ color: '#475569', fontSize: '14px' }}>/ {job.owner_name}</span>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{
            fontSize: '12px', fontWeight: '500', padding: '4px 12px',
            borderRadius: '20px', backgroundColor: status.bg, color: status.text,
          }}>
            {job.job_status.replace(/_/g, ' ')}
          </span>
          {job.job_status === 'draft' && (
            <button
              onClick={() => handleStatusChange('ready')}
              style={{
                padding: '8px 16px', border: '1px solid #334155',
                borderRadius: '8px', backgroundColor: 'transparent',
                fontSize: '13px', cursor: 'pointer', color: '#94a3b8',
              }}
            >
              Mark as ready
            </button>
          )}
          <button
            onClick={handleRunAutomation}
            disabled={job.job_status !== 'ready' || runningAutomation}
            style={{
              padding: '8px 18px',
              backgroundColor: job.job_status === 'ready' && !runningAutomation ? '#2563eb' : '#334155',
              color: job.job_status === 'ready' && !runningAutomation ? 'white' : '#64748b',
              border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
              cursor: job.job_status === 'ready' && !runningAutomation ? 'pointer' : 'not-allowed',
            }}
          >
            {runningAutomation ? 'Starting...' : 'Run automation →'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '32px auto', padding: '0 32px' }}>

        {/* Automation message */}
        {automationMessage && (
          <div style={{
            padding: '14px 18px', borderRadius: '10px', marginBottom: '24px',
            backgroundColor: automationMessage.startsWith('Error') ? '#fee2e2' : '#f0fdf4',
            border: '1px solid ' + (automationMessage.startsWith('Error') ? '#fca5a5' : '#86efac'),
            fontSize: '14px',
            color: automationMessage.startsWith('Error') ? '#b91c1c' : '#15803d',
          }}>
            {automationMessage}
          </div>
        )}

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 4px 0' }}>Property address</p>
            <p style={{ fontSize: '15px', fontWeight: '600', margin: 0, color: '#0f172a' }}>{job.property_address}</p>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
              {job.property_city}, {job.property_state} {job.property_zip}
            </p>
          </div>
          <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 4px 0' }}>Contract value</p>
            <p style={{ fontSize: '26px', fontWeight: '700', margin: 0, color: '#0f172a' }}>
              {job.valuation ? `$${Number(job.valuation).toLocaleString()}` : '—'}
            </p>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
              {job.roof_type || 'Roof type not set'}
            </p>
          </div>
        </div>

        {/* NOC Pipeline */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Notice of Commencement</h2>
          <PipelineTracker
            stages={nocStages}
            currentIndex={currentNocIndex}
            isError={nocStatus === 'error'}
          />
          {job.noc_generated_at && (
            <div style={{ marginTop: '20px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              {job.noc_generated_at && <div><p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 2px 0' }}>Generated</p><p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{new Date(job.noc_generated_at).toLocaleString()}</p></div>}
              {job.noc_sent_at && <div><p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 2px 0' }}>Sent</p><p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{new Date(job.noc_sent_at).toLocaleString()}</p></div>}
              {job.noc_signed_at && <div><p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 2px 0' }}>Signed</p><p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{new Date(job.noc_signed_at).toLocaleString()}</p></div>}
              {job.noc_recorded_at && <div><p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 2px 0' }}>Recorded</p><p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{new Date(job.noc_recorded_at).toLocaleString()}</p></div>}
              {job.noc_recording_number && <div><p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 2px 0' }}>Recording #</p><p style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', margin: 0 }}>{job.noc_recording_number}</p></div>}
            </div>
          )}
        </div>

        {/* Permit Pipeline */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Permit Application</h2>
          <PipelineTracker
            stages={permitStages}
            currentIndex={currentPermitIndex}
            isError={false}
          />
        </div>

        {/* Homeowner */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Homeowner information</h2>
          <div style={gridStyle}>
            <Field label="Owner name" value={job.owner_name} />
            <Field label="Phone" value={job.owner_phone} />
            <Field label="Email" value={job.owner_email} />
          </div>
        </div>

        {/* Job scope */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Job scope</h2>
          <div style={{ marginBottom: '20px' }}>
            <Field label="Scope of work" value={job.scope_of_work} />
          </div>
          <div style={gridStyle}>
            <Field label="Roof type" value={job.roof_type} />
            <Field label="Contract value" value={job.valuation ? `$${Number(job.valuation).toLocaleString()}` : null} />
            <Field label="Parcel number" value={job.parcel_number} />
            <Field label="Property type" value={job.property_type} />
          </div>
        </div>

        {/* Materials */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Materials and product approvals</h2>
          <MaterialSection title="Primary material" material={roofSpecs.primary_material} />
          <MaterialSection title="Underlayment" material={roofSpecs.underlayment} />
          <MaterialSection title="Ventilation" material={roofSpecs.ventilation} />
        </div>

        {/* Documents */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Documents</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {documentTypes.map(docType => {
              const uploaded = documents.find(d => d.document_type === docType.key)
              return (
                <div key={docType.key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: '8px',
                  backgroundColor: uploaded ? '#f0fdf4' : 'white',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '16px' }}>{uploaded ? '✓' : '○'}</span>
                    <span style={{ fontSize: '14px', color: uploaded ? '#15803d' : '#374151', fontWeight: uploaded ? '500' : '400' }}>
                      {docType.label}
                    </span>
                    {uploaded && <span style={{ fontSize: '12px', color: '#64748b' }}>{uploaded.file_name}</span>}
                  </div>
                  <label style={{
                    fontSize: '13px', padding: '6px 14px', border: '1px solid #e2e8f0',
                    borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', color: '#475569',
                  }}>
                    {uploaded ? 'Replace' : 'Upload'}
                    <input type="file" style={{ display: 'none' }} onChange={e => handleFileUpload(e, docType.key)} accept=".pdf,.jpg,.jpeg,.png" />
                  </label>
                </div>
              )
            })}
          </div>
          {uploading && <p style={{ fontSize: '13px', color: '#64748b', marginTop: '12px' }}>Uploading...</p>}
        </div>

        {/* Notes */}
        {job.internal_notes && (
          <div style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Internal notes</h2>
            <p style={{ fontSize: '14px', color: '#374151', margin: 0 }}>{job.internal_notes}</p>
          </div>
        )}

        {/* Activity */}
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Activity</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#cbd5e1', marginTop: '5px', flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '14px', margin: 0, color: '#374151' }}>Job created</p>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>{new Date(job.created_at).toLocaleString()}</p>
              </div>
            </div>
            {job.noc_status && job.noc_status !== 'not_started' && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2563eb', marginTop: '5px', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '14px', margin: 0, color: '#374151' }}>NOC: <strong>{job.noc_status.replace(/_/g, ' ')}</strong></p>
                  <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>{new Date(job.updated_at).toLocaleString()}</p>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: status.text, marginTop: '5px', flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '14px', margin: 0, color: '#374151' }}>Permit status: <strong>{job.job_status.replace(/_/g, ' ')}</strong></p>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0 0' }}>{new Date(job.updated_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}