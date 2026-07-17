/**
 * Public homeowner tracker timeline — sanitized stages only.
 * Shared by GET /api/track/[jobId] and the track page.
 */

export const PUBLIC_TRACKER_STAGES = [
  {
    key: 'job_received',
    label: 'Job Received',
    match: function () { return true },
  },
  {
    key: 'info_validated',
    label: 'Information Validated',
    match: function (job) {
      return Boolean(job.parcel_number) || !['draft'].includes(job.job_status)
    },
  },
  {
    key: 'noc_generated',
    label: 'Notice of Commencement Generated',
    match: function (job) {
      return [
        'generated',
        'ready_for_download',
        'queued_for_notarization',
        'sent_to_homeowner',
        'sent_for_notarization',
        'signed',
        'notarized',
        'queued_for_erecord',
        'ready_for_erecord_review',
        'submitted_to_erecord',
        'recorded',
      ].includes(job.noc_status) || Boolean(job.noc_file_path)
    },
  },
  {
    key: 'noc_sent',
    label: 'NOC Sent for Notarization',
    match: function (job) {
      return [
        'sent_to_homeowner',
        'sent_for_notarization',
        'signed',
        'notarized',
        'queued_for_erecord',
        'ready_for_erecord_review',
        'submitted_to_erecord',
        'recorded',
      ].includes(job.noc_status)
    },
  },
  {
    key: 'awaiting_signature',
    label: 'Awaiting Homeowner Signature',
    match: function (job) {
      return [
        'signed',
        'notarized',
        'queued_for_erecord',
        'ready_for_erecord_review',
        'submitted_to_erecord',
        'recorded',
      ].includes(job.noc_status)
    },
    // Show as "current" while waiting on homeowner
    isCurrentWhen: function (job) {
      return ['sent_to_homeowner', 'sent_for_notarization'].includes(job.noc_status)
    },
  },
  {
    key: 'noc_recording',
    label: 'NOC Recording',
    match: function (job) {
      return job.noc_status === 'recorded'
    },
    isCurrentWhen: function (job) {
      return [
        'notarized',
        'queued_for_erecord',
        'ready_for_erecord_review',
        'submitted_to_erecord',
      ].includes(job.noc_status)
    },
  },
  {
    key: 'permit_submitted',
    label: 'Permit Application Submitted',
    match: function (job) {
      return ['submitted', 'approved', 'permit_issued'].includes(job.job_status)
    },
  },
  {
    key: 'under_review',
    label: 'Under County Review',
    match: function (job) {
      return ['approved', 'permit_issued'].includes(job.job_status)
    },
    isCurrentWhen: function (job) {
      return job.job_status === 'submitted'
    },
  },
  {
    key: 'permit_issued',
    label: 'Permit Issued',
    match: function (job) {
      return job.job_status === 'permit_issued'
    },
  },
]

function pickTimestamp(job, stageKey, runsByType) {
  if (stageKey === 'job_received') return job.created_at || null
  if (stageKey === 'info_validated') {
    return job.parcel_retrieved_at || job.updated_at || job.created_at || null
  }
  if (stageKey === 'noc_generated') {
    return runsByType.noc_generate || job.noc_generated_at || job.updated_at || null
  }
  if (stageKey === 'noc_sent') {
    return runsByType.proof_send || job.noc_sent_at || job.updated_at || null
  }
  if (stageKey === 'awaiting_signature') {
    return runsByType.proof_check || job.updated_at || null
  }
  if (stageKey === 'noc_recording') {
    return runsByType.erecord_submit || runsByType.erecord_prepare || job.updated_at || null
  }
  if (stageKey === 'permit_submitted' || stageKey === 'under_review') {
    return runsByType.permit_submit || job.updated_at || null
  }
  if (stageKey === 'permit_issued') {
    return job.permit_issued_at || job.updated_at || null
  }
  return job.updated_at || null
}

/**
 * Build public timeline stages with status + optional timestamps.
 * @param {object} job — sanitized job fields only
 * @param {Array<{run_type:string, completed_at?:string, started_at?:string, run_status:string}>} runs
 */
export function buildPublicTimeline(job, runs) {
  const runsByType = {}
  ;(runs || []).forEach(function (run) {
    if (!run || !run.run_type) return
    const ts = run.completed_at || run.started_at
    if (!ts) return
    if (!runsByType[run.run_type] || ts > runsByType[run.run_type]) {
      runsByType[run.run_type] = ts
    }
  })

  let currentIndex = -1
  for (let i = 0; i < PUBLIC_TRACKER_STAGES.length; i++) {
    const def = PUBLIC_TRACKER_STAGES[i]
    if (def.isCurrentWhen && def.isCurrentWhen(job)) {
      currentIndex = i
      break
    }
  }
  if (currentIndex < 0) {
    currentIndex = PUBLIC_TRACKER_STAGES.findIndex(function (stage) {
      return !stage.match(job)
    })
    if (currentIndex < 0) currentIndex = PUBLIC_TRACKER_STAGES.length - 1
  }

  return PUBLIC_TRACKER_STAGES.map(function (stage, idx) {
    const complete = stage.match(job)
    let status = 'pending'
    if (complete) status = 'complete'
    if (!complete && idx === currentIndex) status = 'current'
    // If isCurrentWhen points at a stage that is not yet "complete", force current
    if (idx === currentIndex && stage.isCurrentWhen && stage.isCurrentWhen(job) && !complete) {
      status = 'current'
    }

    return {
      key: stage.key,
      label: stage.label,
      status: status,
      timestamp: complete ? pickTimestamp(job, stage.key, runsByType) : null,
    }
  })
}

export function getPublicTrackerPortalBase() {
  const raw = String(process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.dartiq.dev').replace(/\/$/, '')
  return raw
}
