'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import { safeGetSession, redirectIfStaleSession } from '../../../lib/auth/safe-auth'
import {
  permitStatusConfig,
  nocStatusConfig,
  jobTimelineStages,
  getTimelineProgress,
} from '../../../lib/contractor/status-config'
import {
  contractorTheme,
  contractorCardStyle,
  contractorStatCardStyle,
  contractorPrimaryButtonStyle,
} from '../../../lib/ui/contractor-theme'

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
  permit_issued: 'Permit Issued',
}

function getCurrentStageLabel(job) {
  if (job.job_status === 'permit_issued') return STAGE_LABELS.permit_issued
  const progress = getTimelineProgress(job)
  const stage = jobTimelineStages[progress]
  if (!stage) return 'Job Submitted'
  return STAGE_LABELS[stage.key] || stage.label
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function ContractorDashboardPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState([])
  const [pendingReviewJobIds, setPendingReviewJobIds] = useState(new Set())
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadJobs()
  }, [])

  async function loadJobs() {
    try {
      const supabase = createClient()
      const { session, staleSession } = await safeGetSession(supabase)
      if (redirectIfStaleSession(router, staleSession)) return
      if (!session) { router.replace('/login'); return }

      const { data: userData } = await supabase
        .from('users')
        .select('company_id, role')
        .eq('id', session.user.id)
        .single()

      if (userData?.role !== 'company_admin' || !userData?.company_id) {
        setError('Contractor access required')
        setLoading(false)
        return
      }

      const { data: companyData } = await supabase
        .from('companies')
        .select('name')
        .eq('id', userData.company_id)
        .single()

      if (companyData?.name) setCompanyName(companyData.name)

      const response = await fetch('/api/contractor/jobs', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Failed to load jobs')
      } else {
        const scoped = (result.jobs || []).filter(
          job => job.company_id === userData.company_id || job.company_id === result.companyId
        )
        setJobs(scoped)

        const { data: pendingReviews } = await supabase
          .from('review_requests')
          .select('job_id')
          .eq('company_id', userData.company_id)
          .eq('review_status', 'pending')

        setPendingReviewJobIds(new Set((pendingReviews || []).map(r => r.job_id)))
      }
      setLoading(false)
    } catch (err) {
      console.error('[auth] Contractor dashboard load failed:', err)
      router.replace('/login')
    }
  }

  if (loading) {
    return (
      <div className="contractor-page" style={{ padding: '64px 16px', textAlign: 'center' }}>
        <p style={{ color: contractorTheme.textMuted, fontSize: '15px' }}>Loading your applications...</p>
      </div>
    )
  }

  const stats = {
    total: jobs.length,
    active: jobs.filter(j => !['draft', 'cancelled', 'permit_issued'].includes(j.job_status)).length,
    review: jobs.filter(j => pendingReviewJobIds.has(j.id)).length,
    issued: jobs.filter(j => j.job_status === 'permit_issued').length,
  }

  const greeting = getGreeting()
  const welcomeName = companyName || 'Contractor'

  return (
    <div className="contractor-page">
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: '700', color: contractorTheme.text, margin: 0 }}>
          {greeting}, <span style={{ color: '#f97316' }}>{welcomeName}</span> 👋
        </h1>
        <p style={{ fontSize: '15px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
          DART iQ Contractor Portal — Your data is private and secured
        </p>
      </div>

      <div className="contractor-dashboard-header">
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: contractorTheme.text, margin: 0 }}>
            Dashboard
          </h2>
          <p style={{ fontSize: '14px', color: contractorTheme.textMuted, margin: '6px 0 0 0' }}>
            Track every permit application in one place
          </p>
        </div>
        <button
          type="button"
          className="contractor-btn-primary contractor-btn-block-mobile"
          onClick={() => router.push('/contractor/jobs/new')}
          style={contractorPrimaryButtonStyle(false)}
        >
          + New Permit Application
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '14px 18px',
            backgroundColor: contractorTheme.errorSoft,
            borderRadius: '10px',
            marginBottom: '24px',
            color: contractorTheme.error,
            fontSize: '14px',
            border: '1px solid ' + contractorTheme.border,
          }}
        >
          {error}
        </div>
      )}

      <div className="contractor-dashboard-stats">
        {[
          { label: 'Total applications', value: stats.total, color: contractorTheme.text },
          { label: 'In progress', value: stats.active, color: contractorTheme.accent },
          { label: 'Action required', value: stats.review, color: contractorTheme.warning },
          { label: 'Permits issued', value: stats.issued, color: contractorTheme.success },
        ].map(stat => (
          <div key={stat.label} style={contractorStatCardStyle(stat.color)}>
            <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '0 0 8px 0' }}>{stat.label}</p>
            <p style={{ fontSize: '32px', fontWeight: '700', color: stat.color, margin: 0 }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 16px 0', color: contractorTheme.text }}>
        Your applications
      </h2>

      {jobs.length === 0 ? (
        <div style={{ ...contractorCardStyle(), padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ color: contractorTheme.text, fontSize: '17px', fontWeight: '600', margin: '0 0 8px 0' }}>
            No applications yet
          </p>
          <p
            style={{
              color: contractorTheme.textMuted,
              fontSize: '15px',
              margin: '0 auto 20px',
              maxWidth: '400px',
            }}
          >
            Start your first permit application and Dart iQ will guide it from intake through county submission.
          </p>
          <button
            type="button"
            className="contractor-btn-primary contractor-btn-block-mobile"
            onClick={() => router.push('/contractor/jobs/new')}
            style={contractorPrimaryButtonStyle(false)}
          >
            New Permit Application
          </button>
        </div>
      ) : (
        <div className="contractor-dashboard-jobs">
          {jobs.map(job => {
            const pStatus = permitStatusConfig[job.job_status] || permitStatusConfig.draft
            const nStatus = nocStatusConfig[job.noc_status || 'not_started'] || nocStatusConfig.not_started
            const actionRequired = pendingReviewJobIds.has(job.id)
            const updatedAt = job.updated_at || job.created_at
            const stageLabel = getCurrentStageLabel(job)

            return (
              <div
                key={job.id}
                style={{
                  ...contractorCardStyle(),
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  width: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      className="contractor-address-ellipsis"
                      style={{
                        fontSize: '15px',
                        fontWeight: '700',
                        color: contractorTheme.text,
                        margin: 0,
                      }}
                      title={job.property_address}
                    >
                      {job.property_address}
                    </p>
                    <p style={{ fontSize: '13px', color: contractorTheme.textMuted, margin: '4px 0 0 0' }}>
                      {job.owner_name}
                    </p>
                  </div>
                  {actionRequired && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: '700',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        backgroundColor: contractorTheme.errorSoft,
                        color: contractorTheme.error,
                        border: '1px solid ' + contractorTheme.border,
                        flexShrink: 0,
                      }}
                    >
                      Action Required
                    </span>
                  )}
                </div>

                <p style={{ fontSize: '13px', color: contractorTheme.textBody, margin: 0, wordBreak: 'break-word' }}>
                  <span style={{ color: contractorTheme.textMuted }}>Stage: </span>
                  {stageLabel}
                </p>

                <p style={{ fontSize: '12px', color: contractorTheme.textMuted, margin: 0 }}>
                  Updated {new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: pStatus.bg,
                      color: pStatus.text,
                      fontWeight: '600',
                    }}
                  >
                    {pStatus.label}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: nStatus.bg,
                      color: nStatus.text,
                      fontWeight: '600',
                    }}
                  >
                    NOC: {nStatus.label}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => router.push(
                    actionRequired ? '/contractor/jobs/' + job.id + '/review' : '/contractor/jobs/' + job.id
                  )}
                  style={{
                    marginTop: '4px',
                    fontSize: '14px',
                    padding: '12px 16px',
                    minHeight: '44px',
                    border: 'none',
                    borderRadius: '8px',
                    backgroundColor: actionRequired ? contractorTheme.errorSoft : contractorTheme.accentSoft,
                    cursor: 'pointer',
                    color: actionRequired ? contractorTheme.error : contractorTheme.accent,
                    fontWeight: '600',
                    width: '100%',
                  }}
                >
                  {actionRequired ? 'Review now' : 'View application'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
