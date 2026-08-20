// lib/permits/packet-review.js
// ZIG-17 PR 3: system-managed packet_incomplete review upsert/resolve.
'use strict'

var { isUniqueViolation } = require('../documents/upsert-canonical-job-document')

var PACKET_INCOMPLETE_REVIEW_TYPE = 'packet_incomplete'
var REVIEW_STATUS_PENDING = 'pending'
var REVIEW_STATUS_RESOLVED = 'resolved'

function writeError(message, cause) {
  return Object.assign(new Error(message), {
    errorCode: 'packet_review_write_failed',
    cause: cause || null,
  })
}

async function findPendingPacketIncompleteReview(supabase, jobId) {
  var result = await supabase
    .from('review_requests')
    .select('id')
    .eq('job_id', jobId)
    .eq('review_type', PACKET_INCOMPLETE_REVIEW_TYPE)
    .eq('review_status', REVIEW_STATUS_PENDING)
    .maybeSingle()

  if (result.error) {
    throw writeError(
      'packet_incomplete review lookup failed: ' + result.error.message,
      result.error
    )
  }
  return result.data || null
}

async function upsertPendingPacketIncompleteReview(supabase, job, options) {
  var opts = options || {}
  if (!job || !job.id) {
    throw new Error('upsertPendingPacketIncompleteReview: job.id is required')
  }
  if (!job.company_id) {
    throw new Error('upsertPendingPacketIncompleteReview: job.company_id is required')
  }

  var existing = await findPendingPacketIncompleteReview(supabase, job.id)
  if (existing && existing.id) {
    return { id: existing.id, reused: true }
  }

  var insert = await supabase
    .from('review_requests')
    .insert({
      job_id: job.id,
      company_id: job.company_id,
      review_type: PACKET_INCOMPLETE_REVIEW_TYPE,
      review_status: REVIEW_STATUS_PENDING,
      reviewer_notes: opts.notes || null,
    })
    .select('id')
    .single()

  if (!insert.error) {
    return { id: insert.data && insert.data.id, reused: false }
  }

  if (!isUniqueViolation(insert.error)) {
    throw writeError(
      'packet_incomplete review insert failed: ' + insert.error.message,
      insert.error
    )
  }

  var raced = await findPendingPacketIncompleteReview(supabase, job.id)
  if (raced && raced.id) {
    return { id: raced.id, reused: true, raced: true }
  }

  throw writeError(
    'packet_incomplete unique violation but no pending row found: ' + insert.error.message,
    insert.error
  )
}

async function resolvePendingPacketIncompleteReviews(supabase, jobId) {
  if (!jobId) {
    throw new Error('resolvePendingPacketIncompleteReviews: jobId is required')
  }

  var result = await supabase
    .from('review_requests')
    .update({
      review_status: REVIEW_STATUS_RESOLVED,
      reviewed_at: new Date().toISOString(),
      reviewer_id: null,
    })
    .eq('job_id', jobId)
    .eq('review_type', PACKET_INCOMPLETE_REVIEW_TYPE)
    .eq('review_status', REVIEW_STATUS_PENDING)

  if (result.error) {
    throw writeError(
      'packet_incomplete review resolve failed: ' + result.error.message,
      result.error
    )
  }

  return { resolved: true }
}

module.exports = {
  PACKET_INCOMPLETE_REVIEW_TYPE: PACKET_INCOMPLETE_REVIEW_TYPE,
  REVIEW_STATUS_PENDING: REVIEW_STATUS_PENDING,
  REVIEW_STATUS_RESOLVED: REVIEW_STATUS_RESOLVED,
  upsertPendingPacketIncompleteReview: upsertPendingPacketIncompleteReview,
  resolvePendingPacketIncompleteReviews: resolvePendingPacketIncompleteReviews,
}
