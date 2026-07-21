'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../../../lib/auth/safe-auth'
import { contractorTheme, contractorCardStyle } from '../../../../../lib/ui/contractor-theme'

export default function ContractorJobReviewPage({ params }) {
  const router = useRouter()
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)
  const [review, setReview] = useState(null)
  const [downloadUrls, setDownloadUrls] = useState({})
  const [documents, setDocuments] = useState([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      const resolved = await params
      setJobId(resolved.id)
      loadPage(resolved.id)
    }
    init()
  }, [])

  async function loadPage(id) {
    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!session) { router.replace('/login'); return }

      const [jobRes, reviewRes] = await Promise.all([
        fetch('/api/contractor/jobs/' + id, {
          headers: { Authorization: 'Bearer ' + session.access_token },
        }),
        fetch('/api/jobs/' + id + '/review', {
          headers: { Authorization: 'Bearer ' + session.access_token },
        }),
      ])

      const jobData = await jobRes.json()
      const reviewData = await reviewRes.json()

      if (!jobRes.ok) {
        setError(jobData.error || 'Failed to load job')
        setLoading(false)
        return
      }

      if (!reviewRes.ok) {
        setError(reviewData.error || 'Failed to load review')
        setLoading(false)
        return
      }

      if (!reviewData.review) {
        setError('No pending review for this job')
        setLoading(false)
        return
      }

      setJob(jobData.job)
      setReview(reviewData.review)
      setDownloadUrls(jobData.downloadUrls || {})
      setDocuments(jobData.documents || [])
      setLoading(false)
    } catch (err) {
      console.error('[review] load failed:', err)
      setError('Failed to load review page')
      setLoading(false)
    }
  }

  async function submitDecision(decision) {
    if (!jobId) return
    setSubmitting(true)
    setError('')

    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!session) { router.replace('/login'); return }

      const response = await fetch('/api/jobs/' + jobId + '/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ decision, notes }),
      })

      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Failed to submit review')
        setSubmitting(false)
        return
      }

      router.push('/contractor/jobs/' + jobId)
    } catch (err) {
      setError(err.message || 'Failed to submit review')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center' }}><p style={{ color: contractorTheme.textMuted }}>Loading review...</p></div>
  }

  if (error || !job || !review) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted }}>{error || 'Review not found'}</p>
        <button onClick={() => router.push('/contractor/dashboard')} style={{ marginTop: '16px', color: contractorTheme.accent, background: 'none', border: 'none', cursor: 'pointer' }}>
          Back to dashboard
        </button>
      </div>
    )
  }

  const sectionStyle = { ...contractorCardStyle(), padding: '24px', marginBottom: '20px' }
  const isNocReview = review.review_type === 'noc_before_send'
  const isManualNocCompletion = review.review_type === 'noc_manual_completion'
  const capacityMessage = job.job_specs?.noc?.message
    || 'A NOC field exceeds the one-page template capacity — manual NOC completion is required.'
  const screenshotDocs = documents.filter(d =>
    d.document_type?.includes('screenshot') || d.document_type === 'permit_screenshot'
  )

  return (
    <div style={{ maxWidth: '900px', margin: '32px auto', padding: '0 32px 48px' }}>
      <button onClick={() => router.push('/contractor/jobs/' + jobId)}
        style={{ fontSize: '14px', color: contractorTheme.textMuted, background: 'none', border: 'none', cursor: 'pointer', marginBottom: '16px', padding: 0 }}>
        Back to job
      </button>

      <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: '0 0 8px 0' }}>
        {isManualNocCompletion
          ? 'Manual NOC completion required'
          : (isNocReview ? 'Review Notice of Commencement' : 'Review Permit Application')}
      </h1>
      <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '0 0 24px 0' }}>
        {job.property_address}, {job.property_city}, {job.property_state} {job.property_zip}
      </p>

      <div style={sectionStyle}>
        {isManualNocCompletion ? (
          <>
            <p style={{ margin: '0 0 16px 0', fontSize: '15px', color: contractorTheme.error, fontWeight: '600' }}>
              {capacityMessage}
            </p>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: contractorTheme.textBody, lineHeight: 1.5 }}>
              Auto-generated NOC was not created because one or more fields would truncate on the one-page form.
              Complete the Notice of Commencement outside DART iQ, then upload the signed/notarized document
              using the job&apos;s upload NOC option, or contact support for help.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="Owner name" value={job.owner_name} />
              <Field label="Parcel number" value={job.parcel_number} />
              <Field label="Legal description" value={job.legal_description} />
              <Field label="Scope of work" value={job.scope_of_work} />
            </div>
          </>
        ) : isNocReview ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <Field label="Owner name" value={job.owner_name} />
              <Field label="Parcel number" value={job.parcel_number} />
              <Field label="Scope of work" value={job.scope_of_work} />
              <Field label="Legal description" value={job.legal_description} />
            </div>
            {downloadUrls.generated_noc ? (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '13px', fontWeight: '600', color: contractorTheme.text, marginBottom: '8px' }}>NOC PDF preview</p>
                <iframe
                  src={downloadUrls.generated_noc}
                  title="NOC preview"
                  style={{ width: '100%', height: '520px', border: '1px solid ' + contractorTheme.border, borderRadius: '12px' }}
                />
                <a href={downloadUrls.generated_noc} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: '10px', color: contractorTheme.accent, fontSize: '14px', fontWeight: '600' }}>
                  Download NOC PDF
                </a>
              </div>
            ) : (
              <p style={{ color: contractorTheme.textMuted, fontSize: '14px' }}>Generated NOC PDF is not available yet.</p>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <Field label="Owner name" value={job.owner_name} />
              <Field label="Owner email" value={job.owner_email} />
              <Field label="Owner phone" value={job.owner_phone} />
              <Field label="Parcel number" value={job.parcel_number} />
              <Field label="Legal description" value={job.legal_description} />
              <Field label="Roof type" value={job.roof_type} />
              <Field label="Valuation" value={job.valuation ? '$' + Number(job.valuation).toLocaleString() : null} />
              <Field label="Squares" value={job.job_specs?.squares} />
              <Field label="Scope of work" value={job.scope_of_work} />
              <Field label="Material manufacturer" value={job.material_manufacturer} />
              <Field label="Material model" value={job.material_model} />
              <Field label="Approval number" value={job.material_approval_num} />
            </div>
            {job.portal_confirmation && (
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '13px', fontWeight: '600', color: contractorTheme.text, marginBottom: '8px' }}>Portal confirmation</p>
                <pre style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px',
                  backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px',
                  border: '1px solid ' + contractorTheme.border, margin: 0,
                }}>
                  {typeof job.portal_confirmation === 'string'
                    ? job.portal_confirmation
                    : JSON.stringify(job.portal_confirmation, null, 2)}
                </pre>
              </div>
            )}
            {screenshotDocs.length > 0 && (
              <div>
                <p style={{ fontSize: '13px', fontWeight: '600', color: contractorTheme.text, marginBottom: '8px' }}>Automation screenshots</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {screenshotDocs.map(doc => (
                    downloadUrls['doc_' + doc.id] ? (
                      <a key={doc.id} href={downloadUrls['doc_' + doc.id]} target="_blank" rel="noreferrer"
                        style={{ color: contractorTheme.accent, fontSize: '14px', fontWeight: '600' }}>
                        {doc.file_name || 'Permit screenshot'}
                      </a>
                    ) : null
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={sectionStyle}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: contractorTheme.text, marginBottom: '8px' }}>
          Notes {review.review_type === 'permit_before_submit' ? '(required for rejection)' : '(optional)'}
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder={isManualNocCompletion ? 'Optional notes for your team...' : 'Describe what needs to be corrected...'}
          style={{
            width: '100%', padding: '12px', borderRadius: '10px',
            border: '1px solid ' + contractorTheme.border, fontSize: '14px',
            boxSizing: 'border-box', marginBottom: '16px',
          }}
        />

        {error && (
          <p style={{ color: '#b91c1c', fontSize: '14px', marginBottom: '12px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {isManualNocCompletion ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => submitDecision('approved')}
              style={{
                padding: '12px 24px', borderRadius: '999px', border: 'none',
                background: 'linear-gradient(135deg, #0284c7 0%, #059669 100%)',
                color: 'white', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Submitting...' : 'Acknowledge — will complete NOC manually'}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitDecision('approved')}
                style={{
                  padding: '12px 24px', borderRadius: '999px', border: 'none',
                  background: 'linear-gradient(135deg, #0284c7 0%, #059669 100%)',
                  color: 'white', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Submitting...' : (isNocReview ? 'Everything looks correct' : 'Approve and Submit to County')}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => submitDecision('rejected')}
                style={{
                  padding: '12px 24px', borderRadius: '999px',
                  border: '1px solid #fecaca', backgroundColor: '#fef2f2',
                  color: '#b91c1c', fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isNocReview ? 'Something needs fixing' : 'Send Back for Correction'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p style={{ fontSize: '12px', color: contractorTheme.textMuted, margin: '0 0 4px 0' }}>{label}</p>
      <p style={{ fontSize: '14px', color: contractorTheme.textBody, fontWeight: '500', margin: 0 }}>{value || '—'}</p>
    </div>
  )
}
