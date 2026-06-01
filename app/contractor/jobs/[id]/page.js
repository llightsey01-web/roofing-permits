'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import { permitStatusConfig, nocStatusConfig, jobTimelineStages, getTimelineProgress } from '../../../../lib/contractor/status-config'
import { contractorTheme, contractorCardStyle } from '../../../../lib/ui/contractor-theme'

export default function ContractorJobDetailPage({ params }) {
  const router = useRouter()
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)
  const [documents, setDocuments] = useState([])
  const [logs, setLogs] = useState([])
  const [downloadUrls, setDownloadUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      const resolved = await params
      setJobId(resolved.id)
      loadJob(resolved.id)
    }
    init()
  }, [])

  async function loadJob(id) {
    try {
    const supabase = createClient()
    const { session, staleSession } = await safeGetSession(supabase)
    if (redirectIfStaleSession(router, staleSession)) return
    if (!session) { router.replace('/login'); return }

    const response = await fetch('/api/contractor/jobs/' + id, {
      headers: { Authorization: 'Bearer ' + session.access_token },
    })
    const result = await response.json()

    if (!response.ok) {
      setError(result.error || 'Failed to load job')
      setLoading(false)
      return
    }

    setJob(result.job)
    setDocuments(result.documents || [])
    setLogs(result.logs || [])
    setDownloadUrls(result.downloadUrls || {})
    setLoading(false)
    } catch (err) {
      console.error('[auth] Contractor job detail load failed:', err)
      router.replace('/login')
    }
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}><p style={{ color: '#64748b' }}>Loading job...</p></div>
  }

  if (error || !job) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>{error || 'Job not found'}</p>
        <button onClick={() => router.push('/contractor/dashboard')} style={{ marginTop: '16px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
          ← Back to dashboard
        </button>
      </div>
    )
  }

  const pStatus = permitStatusConfig[job.job_status] || permitStatusConfig.draft
  const nStatus = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started
  const timelineProgress = getTimelineProgress(job)

  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = { fontSize: '16px', fontWeight: '600', color: contractorTheme.text, marginBottom: '20px', marginTop: 0, paddingBottom: '12px', borderBottom: '1px solid ' + contractorTheme.border }
  const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }

  function Field({ label, value }) {
    return (
      <div>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 4px 0' }}>{label}</p>
        <p style={{ fontSize: '14px', color: '#0f172a', fontWeight: '500', margin: 0 }}>{value || '—'}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '32px auto', padding: '0 32px 48px' }}>
      <button onClick={() => router.push('/contractor/dashboard')}
        style={{ fontSize: '14px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '16px', padding: 0 }}>
        ← Back to dashboard
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <p style={{ fontSize: '13px', color: contractorTheme.accent, fontWeight: '600', margin: '0 0 4px 0' }}>Job details</p>
          <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>{job.owner_name}</h1>
          <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>{job.property_address}, {job.property_city}, {job.property_state} {job.property_zip}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '20px', backgroundColor: nStatus.bg, color: nStatus.text }}>{nStatus.label}</span>
          <span style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '20px', backgroundColor: pStatus.bg, color: pStatus.text }}>{pStatus.label}</span>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Your progress</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative', paddingLeft: '4px' }}>
          {jobTimelineStages.map((stage, idx) => {
            const complete = idx <= timelineProgress
            const current = idx === timelineProgress
            return (
              <div key={stage.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '10px 0' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: complete ? 'linear-gradient(135deg, #0284c7, #059669)' : contractorTheme.accentSoft,
                  color: complete ? 'white' : contractorTheme.textMuted,
                  fontSize: '13px', fontWeight: '700',
                  border: current ? '3px solid #0284c7' : '2px solid ' + (complete ? 'transparent' : contractorTheme.borderStrong),
                  boxShadow: current ? '0 0 0 4px rgba(2, 132, 199, 0.15)' : 'none',
                }}>
                  {complete ? '✓' : idx + 1}
                </div>
                <div style={{ paddingTop: '6px' }}>
                  <p style={{ fontSize: '15px', fontWeight: current ? '700' : '500', color: complete || current ? contractorTheme.text : contractorTheme.textMuted, margin: 0 }}>
                    {stage.label}
                  </p>
                  {current && !complete && (
                    <p style={{ fontSize: '13px', color: contractorTheme.accent, margin: '4px 0 0 0' }}>In progress</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Homeowner & property</h2>
        <div style={gridStyle}>
          <Field label="Owner name" value={job.owner_name} />
          <Field label="Owner phone" value={job.owner_phone} />
          <Field label="Owner email" value={job.owner_email} />
          <Field label="Roof type" value={job.roof_type} />
          <Field label="Valuation" value={job.valuation ? '$' + Number(job.valuation).toLocaleString() : null} />
          <Field label="Squares" value={job.job_specs?.squares} />
          <Field label="Parcel number" value={job.parcel_number} />
          <Field label="Scope of work" value={job.scope_of_work} />
        </div>
        {job.internal_notes && (
          <div style={{ marginTop: '16px' }}>
            <Field label="Notes" value={job.internal_notes} />
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Documents</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {downloadUrls.generated_noc && (
            <DocumentLink label="Generated NOC" url={downloadUrls.generated_noc} />
          )}
          {downloadUrls.notarized_noc && (
            <DocumentLink label="Notarized NOC" url={downloadUrls.notarized_noc} />
          )}
          {downloadUrls.recorded_noc && (
            <DocumentLink label="Recorded NOC" url={downloadUrls.recorded_noc} />
          )}
          {documents.filter(d => d.document_type?.includes('screenshot') || d.document_type === 'permit_screenshot').map(doc => (
            downloadUrls['doc_' + doc.id] && (
              <DocumentLink key={doc.id} label={doc.file_name || 'Permit screenshot'} url={downloadUrls['doc_' + doc.id]} />
            )
          ))}
          {!downloadUrls.generated_noc && !downloadUrls.notarized_noc && !downloadUrls.recorded_noc &&
            documents.filter(d => d.document_type?.includes('screenshot')).length === 0 && (
            <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: 0 }}>Documents will appear here as your permit moves forward.</p>
          )}
        </div>
        {job.noc_recording_number && (
          <p style={{ fontSize: '13px', color: '#475569', marginTop: '16px' }}>
            Recording number: <strong>{job.noc_recording_number}</strong>
          </p>
        )}
      </div>

      {logs.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Recent updates</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
            {logs.map(log => (
              <div key={log.id} style={{ padding: '10px 12px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#0f172a' }}>{log.step_name || 'Step'}</span>
                  <span style={{ fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                {log.message && <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>{log.message}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentLink({ label, url }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 18px', border: '1px solid ' + contractorTheme.border,
      borderRadius: '12px', backgroundColor: contractorTheme.accentSoft,
      textDecoration: 'none', color: contractorTheme.accent, fontSize: '14px', fontWeight: '600',
    }}>
      <span>{label}</span>
      <span>Download →</span>
    </a>
  )
}
