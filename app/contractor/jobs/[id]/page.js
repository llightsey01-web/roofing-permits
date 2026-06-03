'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../lib/auth/safe-auth'
import { permitStatusConfig, nocStatusConfig, jobTimelineStages } from '../../../../lib/contractor/status-config'
import { contractorTheme, contractorCardStyle } from '../../../../lib/ui/contractor-theme'

const STAGE_LABELS = {
  intake: 'Job Submitted',
  parcel: 'Parcel Retrieved',
  permit_draft: 'Permit Draft Saved',
  noc_generated: 'NOC Generated',
  sent_homeowner: 'Sent to Homeowner',
  notarized: 'Notarized',
  recorded: 'Recorded with County',
  permit_resumed: 'Permit Resumed',
  permit_submitted: 'Permit Submitted',
  permit_issued: 'Permit Issued ✓',
}

const PIPELINE_STAGES = [
  ...jobTimelineStages.filter(s => s.key !== 'permit_resumed'),
  { key: 'permit_issued', label: STAGE_LABELS.permit_issued, match: job => job.job_status === 'permit_issued' },
]

function getStageState(job, stage, index) {
  const hasError = job.job_status === 'needs_correction' || job.noc_status === 'error'
  const isRunning = job.job_status === 'automation_running'

  if (stage.match(job)) return 'complete'

  const prevComplete = index === 0 || PIPELINE_STAGES[index - 1].match(job)
  if (!prevComplete) return 'pending'

  if (hasError) return 'error'
  if (isRunning) return 'in_progress'
  return 'pending'
}

function StageIcon({ state }) {
  const size = 28
  if (state === 'complete') {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: contractorTheme.success,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: '14px', fontWeight: '700', flexShrink: 0,
      }}>
        ✓
      </div>
    )
  }
  if (state === 'in_progress') {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        border: '3px solid ' + contractorTheme.accent,
        borderTopColor: 'transparent',
        flexShrink: 0,
        animation: 'dartiq-spin 0.8s linear infinite',
      }} />
    )
  }
  if (state === 'error') {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: contractorTheme.error,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: '14px', fontWeight: '700', flexShrink: 0,
      }}>
        ✕
      </div>
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      backgroundColor: '#e2e8f0',
      flexShrink: 0,
    }} />
  )
}

export default function ContractorJobDetailPage({ params }) {
  const router = useRouter()
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)
  const [documents, setDocuments] = useState([])
  const [logs, setLogs] = useState([])
  const [downloadUrls, setDownloadUrls] = useState({})
  const [pendingReview, setPendingReview] = useState(null)
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

      const [jobResponse, reviewResponse] = await Promise.all([
        fetch('/api/contractor/jobs/' + id, {
          headers: { Authorization: 'Bearer ' + session.access_token },
        }),
        fetch('/api/jobs/' + id + '/review', {
          headers: { Authorization: 'Bearer ' + session.access_token },
        }),
      ])
      const result = await jobResponse.json()
      const reviewResult = await reviewResponse.json()

      if (!jobResponse.ok) {
        setError(result.error || 'Failed to load job')
        setLoading(false)
        return
      }

      setJob(result.job)
      setDocuments(result.documents || [])
      setLogs(result.logs || [])
      setDownloadUrls(result.downloadUrls || {})
      if (reviewResponse.ok) {
        setPendingReview(reviewResult.review || null)
      }
      setLoading(false)
    } catch (err) {
      console.error('[auth] Contractor job detail load failed:', err)
      router.replace('/login')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>Loading application...</p>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>{error || 'Application not found'}</p>
        <button
          type="button"
          onClick={() => router.push('/contractor/dashboard')}
          style={{ marginTop: '16px', color: contractorTheme.accent, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ← Back to dashboard
        </button>
      </div>
    )
  }

  const pStatus = permitStatusConfig[job.job_status] || permitStatusConfig.draft
  const nStatus = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started

  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: contractorTheme.text,
    marginBottom: '20px',
    marginTop: 0,
    paddingBottom: '12px',
    borderBottom: '1px solid ' + contractorTheme.border,
  }
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }

  function Field({ label, value }) {
    return (
      <div>
        <p style={{ fontSize: '12px', color: contractorTheme.textMuted, margin: '0 0 4px 0' }}>{label}</p>
        <p style={{ fontSize: '14px', color: contractorTheme.text, fontWeight: '500', margin: 0 }}>{value || '—'}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '920px', margin: '28px auto', padding: '0 24px 48px' }}>
      <style>{'@keyframes dartiq-spin { to { transform: rotate(360deg); } }'}</style>

      <button
        type="button"
        onClick={() => router.push('/contractor/dashboard')}
        style={{
          fontSize: '14px',
          color: contractorTheme.textMuted,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          marginBottom: '16px',
          padding: 0,
        }}
      >
        ← Back to dashboard
      </button>

      {pendingReview && (
        <div style={{
          ...contractorCardStyle(),
          padding: '18px 20px',
          marginBottom: '20px',
          backgroundColor: contractorTheme.errorSoft,
          border: '1px solid #fecaca',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: contractorTheme.error }}>Action Required</p>
            <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: '#7f1d1d' }}>
              {pendingReview.review_type === 'noc_before_send'
                ? 'Review the NOC before it is sent to the homeowner.'
                : 'Review the permit application before county submission.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/contractor/jobs/' + jobId + '/review')}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: contractorTheme.error,
              color: 'white',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Open review
          </button>
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '24px',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ fontSize: '13px', color: contractorTheme.accent, fontWeight: '600', margin: '0 0 4px 0' }}>
            Dart iQ application
          </p>
          <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>{job.owner_name}</h1>
          <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
            {job.property_address}, {job.property_city}, {job.property_state} {job.property_zip}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '12px',
            padding: '4px 12px',
            borderRadius: '6px',
            backgroundColor: nStatus.bg,
            color: nStatus.text,
            fontWeight: '600',
          }}>
            {nStatus.label}
          </span>
          <span style={{
            fontSize: '12px',
            padding: '4px 12px',
            borderRadius: '6px',
            backgroundColor: pStatus.bg,
            color: pStatus.text,
            fontWeight: '600',
          }}>
            {pStatus.label}
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Permit pipeline</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {PIPELINE_STAGES.map((stage, idx) => {
            const state = getStageState(job, stage, idx)
            const label = STAGE_LABELS[stage.key] || stage.label
            const showHomeowner = stage.key === 'sent_homeowner' && job.owner_name

            return (
              <div
                key={stage.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px',
                  padding: '12px 0',
                  borderBottom: idx < PIPELINE_STAGES.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}
              >
                <StageIcon state={state} />
                <div style={{ paddingTop: '2px', flex: 1 }}>
                  <p style={{
                    fontSize: '15px',
                    fontWeight: state === 'in_progress' ? '700' : '500',
                    color: state === 'pending' ? contractorTheme.textMuted : contractorTheme.text,
                    margin: 0,
                  }}>
                    {label}
                  </p>
                  {showHomeowner && (
                    <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '4px 0 0 0' }}>
                      Homeowner: {job.owner_name}
                    </p>
                  )}
                  {state === 'in_progress' && (
                    <p style={{ fontSize: '13px', color: contractorTheme.accent, margin: '4px 0 0 0' }}>In progress</p>
                  )}
                  {state === 'error' && (
                    <p style={{ fontSize: '13px', color: contractorTheme.error, margin: '4px 0 0 0' }}>Needs attention</p>
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
            <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: 0 }}>
              Documents will appear here as your application moves forward.
            </p>
          )}
        </div>
        {job.noc_recording_number && (
          <p style={{ fontSize: '13px', color: contractorTheme.textBody, marginTop: '16px' }}>
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
                  <span style={{ fontSize: '13px', fontWeight: '500', color: contractorTheme.text }}>{log.step_name || 'Step'}</span>
                  <span style={{ fontSize: '12px', color: contractorTheme.textMuted, flexShrink: 0 }}>
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                {log.message && <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '4px 0 0 0' }}>{log.message}</p>}
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
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        border: '1px solid ' + contractorTheme.border,
        borderRadius: '10px',
        backgroundColor: contractorTheme.accentSoft,
        textDecoration: 'none',
        color: contractorTheme.accent,
        fontSize: '14px',
        fontWeight: '600',
      }}
    >
      <span>{label}</span>
      <span>Download →</span>
    </a>
  )
}
