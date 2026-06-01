// lib/automation/noc-after-noc-core.js
// Proof + eRecord chain after NOC exists (no Proof completion polling — safe for Next API routes)

const { createClient } = require('@supabase/supabase-js')
const {
  sendNocToProof,
  evaluateProofSendGate,
} = require('../proof/send-noc-to-proof')
const { getProofTransactionId } = require('../proof/proof-job-meta')
const { queueErecordForJob, prepareRecordingPackage } = require('../erecord/service')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function reloadJob(jobId) {
  var supabase = getSupabase()
  var { data: job, error } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) throw new Error('Job not found: ' + jobId)
  return job
}

function isPhase1Complete(job) {
  return !!(
    job.parcel_number && String(job.parcel_number).trim() &&
    job.legal_description && String(job.legal_description).trim() &&
    job.portal_confirmation && String(job.portal_confirmation).trim()
  )
}

function hasGeneratedNoc(job) {
  return !!(job.noc_file_path && String(job.noc_file_path).trim())
}

function isProofInFlight(job) {
  return job.noc_status === 'sent_to_homeowner' ||
    !!(job.job_specs && job.job_specs.proof && job.job_specs.proof.transaction_id)
}

function hasNotarizedPdf(job) {
  return !!(job.job_specs && job.job_specs.proof && job.job_specs.proof.notarized_file_path)
}

function isReadyForErecordReview(job) {
  return job.noc_status === 'ready_for_erecord_review'
}

async function continueToErecordPrep(jobId, options) {
  var opts = options || {}
  var job = await reloadJob(jobId)

  if (!hasNotarizedPdf(job)) {
    return { success: false, skipped: true, reason: 'notarized_file_path missing' }
  }

  if (isReadyForErecordReview(job)) {
    return {
      success: true,
      skipped: true,
      reason: 'already ready_for_erecord_review',
      packId: job.job_specs?.erecord?.package_id || null,
      nocStatus: job.noc_status,
    }
  }

  if (job.noc_status !== 'queued_for_erecord') {
    await queueErecordForJob(jobId, { provider: 'epn' })
  }

  var prepResult = await prepareRecordingPackage(jobId, opts)
  return Object.assign({ success: true, skipped: false }, prepResult)
}

async function continueAfterNocGenerated(jobId, options) {
  var opts = options || {}
  var result = {
    jobId: jobId,
    phases: {},
    stoppingPoint: null,
  }

  var job = await reloadJob(jobId)

  if (!hasGeneratedNoc(job)) {
    result.stoppingPoint = 'noc_missing'
    result.phases.noc = { skipped: true, reason: 'generated NOC not found' }
    return result
  }

  if (!isProofInFlight(job) && !hasNotarizedPdf(job)) {
    var gate = evaluateProofSendGate(job)
    result.phases.proofSendGate = gate

    if (gate.allowed) {
      console.log('[chain] Auto-triggering Proof send for job ' + jobId)
      result.phases.proofSend = await sendNocToProof(jobId, opts)
      job = await reloadJob(jobId)
    } else {
      result.phases.proofSend = {
        success: false,
        skipped: true,
        reason: gate.reasons.join('; '),
        autoBlocked: true,
      }
      result.stoppingPoint = 'proof_send_gated'
      return result
    }
  } else {
    result.phases.proofSend = {
      skipped: true,
      reason: hasNotarizedPdf(job) ? 'notarized PDF already exists' : 'Proof already in flight',
      transaction_id: getProofTransactionId(job),
      noc_status: job.noc_status,
    }
  }

  if (result.phases.proofSend && result.phases.proofSend.skipped && result.phases.proofSend.autoBlocked) {
    return result
  }

  if (result.phases.proofSend && result.phases.proofSend.skipped && !isProofInFlight(job) && !hasNotarizedPdf(job)) {
    result.stoppingPoint = 'proof_send_skipped'
    return result
  }

  if (isProofInFlight(job) && !hasNotarizedPdf(job)) {
    if (opts.waitForProofCompletion !== false) {
      console.log('[chain] Waiting for Proof notarization...')
      if (!opts.waitForProofCompletionFn) {
        result.phases.proofComplete = {
          skipped: true,
          reason: 'waitForProofCompletionFn not provided (use worker runPostPhase1Chain)',
        }
        result.stoppingPoint = 'waiting_for_proof'
      } else {
        result.phases.proofComplete = await opts.waitForProofCompletionFn(jobId, opts)
        result.stoppingPoint = result.phases.proofComplete.stoppingPoint || 'waiting_for_proof'
      }
    } else {
      result.stoppingPoint = 'waiting_for_proof'
      result.phases.proofComplete = { skipped: true, reason: 'waitForProofCompletion=false' }
    }
    return result
  }

  if (hasNotarizedPdf(job) && !isReadyForErecordReview(job)) {
    console.log('[chain] Continuing to eRecord prep...')
    result.phases.erecord = await continueToErecordPrep(jobId, opts)
    job = await reloadJob(jobId)
    result.stoppingPoint = isReadyForErecordReview(job)
      ? 'ready_for_erecord_review'
      : 'queued_for_erecord'
    return result
  }

  if (isReadyForErecordReview(job)) {
    result.stoppingPoint = 'ready_for_erecord_review'
  } else if (hasNotarizedPdf(job)) {
    result.stoppingPoint = 'queued_for_erecord'
  } else {
    result.stoppingPoint = 'waiting_for_proof'
  }

  return result
}

module.exports = {
  isPhase1Complete,
  hasGeneratedNoc,
  isProofInFlight,
  hasNotarizedPdf,
  isReadyForErecordReview,
  continueToErecordPrep,
  continueAfterNocGenerated,
  reloadJob,
}
