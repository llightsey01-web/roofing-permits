export const permitStatusConfig = {
  draft:              { bg: '#f1f5f9', text: '#475569', label: 'Draft' },
  ready:              { bg: '#dbeafe', text: '#1d4ed8', label: 'Ready' },
  automation_running: { bg: '#fef3c7', text: '#b45309', label: 'Running' },
  needs_review:       { bg: '#fef9c3', text: '#854d0e', label: 'Review needed' },
  needs_correction:   { bg: '#fee2e2', text: '#b91c1c', label: 'Needs correction' },
  approved:           { bg: '#dcfce7', text: '#15803d', label: 'Approved' },
  submitted:          { bg: '#d1fae5', text: '#065f46', label: 'Submitted' },
  permit_issued:      { bg: '#bbf7d0', text: '#14532d', label: 'Permit issued' },
  on_hold:            { bg: '#fee2e2', text: '#b91c1c', label: 'On hold' },
  cancelled:          { bg: '#f1f5f9', text: '#64748b', label: 'Cancelled' },
  waiting_for_noc:    { bg: '#e0e7ff', text: '#4338ca', label: 'Waiting for NOC' },
}

export const nocStatusConfig = {
  not_started:              { bg: '#f1f5f9', text: '#94a3b8', label: 'Not started', dot: '#cbd5e1' },
  generated:                { bg: '#eff6ff', text: '#3b82f6', label: 'Generated', dot: '#3b82f6' },
  queued_for_notarization:  { bg: '#eff6ff', text: '#2563eb', label: 'Queued', dot: '#2563eb' },
  sent_to_homeowner:        { bg: '#dbeafe', text: '#1d4ed8', label: 'Sent to homeowner', dot: '#2563eb' },
  sent_for_notarization:    { bg: '#fef3c7', text: '#d97706', label: 'Awaiting signature', dot: '#f59e0b' },
  signed:                   { bg: '#d1fae5', text: '#059669', label: 'Signed', dot: '#10b981' },
  notarized:                { bg: '#d1fae5', text: '#047857', label: 'Notarized', dot: '#059669' },
  queued_for_erecord:       { bg: '#e0e7ff', text: '#4338ca', label: 'Queued for eRecord', dot: '#6366f1' },
  ready_for_erecord_review: { bg: '#fef3c7', text: '#b45309', label: 'Ready for eRecord review', dot: '#f59e0b' },
  submitted_to_erecord:     { bg: '#e0e7ff', text: '#4338ca', label: 'Recording in progress', dot: '#6366f1' },
  recorded:                 { bg: '#bbf7d0', text: '#14532d', label: 'Recorded', dot: '#16a34a' },
  error:                    { bg: '#fee2e2', text: '#b91c1c', label: 'Error', dot: '#ef4444' },
}

export function getRecordingStatusLabel(nocStatus) {
  if (nocStatus === 'recorded') return 'Recorded'
  if (nocStatus === 'ready_for_erecord_review') return 'Ready for review'
  if (nocStatus === 'queued_for_erecord') return 'Queued'
  if (nocStatus === 'submitted_to_erecord') return 'In progress'
  if (['notarized', 'signed'].includes(nocStatus)) return 'Pending'
  if (nocStatus === 'not_started') return 'Not started'
  return 'Not started'
}

export const jobTimelineStages = [
  { key: 'intake', label: 'Intake', match: () => true },
  { key: 'parcel', label: 'Parcel found', match: job => Boolean(job.parcel_number) },
  { key: 'permit_draft', label: 'Permit draft saved', match: job => Boolean(job.portal_confirmation) },
  { key: 'noc_generated', label: 'NOC generated', match: job => ['generated', 'queued_for_notarization', 'sent_to_homeowner', 'sent_for_notarization', 'signed', 'notarized', 'submitted_to_erecord', 'recorded'].includes(job.noc_status) || Boolean(job.noc_file_path) },
  { key: 'sent_homeowner', label: 'Sent to homeowner', match: job => ['sent_to_homeowner', 'sent_for_notarization', 'signed', 'notarized', 'submitted_to_erecord', 'recorded'].includes(job.noc_status) },
  { key: 'notarized', label: 'Notarized', match: job => ['notarized', 'queued_for_erecord', 'ready_for_erecord_review', 'submitted_to_erecord', 'recorded'].includes(job.noc_status) },
  { key: 'recorded', label: 'Recorded', match: job => job.noc_status === 'recorded' },
  { key: 'permit_resumed', label: 'Permit resumed', match: job => ['automation_running', 'needs_review', 'submitted', 'approved', 'permit_issued'].includes(job.job_status) && job.noc_status === 'recorded' },
  { key: 'permit_submitted', label: 'Permit submitted', match: job => ['submitted', 'approved', 'permit_issued'].includes(job.job_status) },
]

export function getTimelineProgress(job) {
  let lastComplete = 0
  jobTimelineStages.forEach((stage, idx) => {
    if (stage.match(job)) lastComplete = idx
  })
  return lastComplete
}
