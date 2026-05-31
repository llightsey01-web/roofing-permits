// lib/proof/job-identity.js
// Proof transaction identity + strict job matching

const SENT_AT_MATCH_WINDOW_MS = 10 * 60 * 1000

function buildExpectedDocumentName(jobId) {
  return 'noc-' + jobId + '.pdf'
}

function buildExpectedTransactionTitle(jobId, propertyAddress) {
  var address = String(propertyAddress || '').trim() || 'unknown address'
  return 'AHJ-iQ NOC - ' + jobId + ' - ' + address
}

function buildSignerMessage(job, jobId) {
  var lines = [
    'AHJ-iQ Job ID: ' + jobId,
    'Property: ' + String(job.property_address || '').trim(),
    'Parcel: ' + String(job.parcel_number || 'n/a').trim(),
  ]
  return lines.join('\n')
}

function buildProofIdentity(job, jobId) {
  return {
    job_id: jobId,
    expected_document_name: buildExpectedDocumentName(jobId),
    expected_transaction_title: buildExpectedTransactionTitle(jobId, job.property_address),
    signer_message: buildSignerMessage(job, jobId),
  }
}

function getStoredProofIdentity(job, jobId) {
  var existing = job && job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
  var identity = buildProofIdentity(job, jobId)
  return {
    job_id: jobId,
    expected_document_name: existing.expected_document_name || identity.expected_document_name,
    expected_transaction_title: existing.expected_transaction_title || identity.expected_transaction_title,
    signer_message: identity.signer_message,
    sent_at: existing.sent_at || job.noc_sent_at || null,
    signer_email: existing.signer_email || job.owner_email || null,
  }
}

function haystackFromRecord(record) {
  if (!record) return ''
  return [
    record.transactionName,
    record.transactionTitle,
    record.text,
    record.rawText,
    record.rowText,
    record.documentName,
    (record.documentNames || []).join(' '),
    record.href,
    record.rowUrl,
    record.summaryUrl,
    record.detailUrl,
    record.recipientName,
    record.recipient,
    record.recipientEmail,
    (record.recipientEmails || []).join(' '),
    record.notes,
    record.signerMessage,
  ].filter(Boolean).join(' ').toLowerCase()
}

function parseRecordDate(value) {
  if (!value) return null
  var match = String(value).match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return null
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
}

function isWithinSentAtWindow(sentAt, record, nowMs) {
  if (!sentAt) return false
  var sentMs = new Date(sentAt).getTime()
  if (isNaN(sentMs)) return false

  var now = nowMs || Date.now()
  if (Math.abs(now - sentMs) <= SENT_AT_MATCH_WINDOW_MS) {
    return true
  }

  var recordDate = parseRecordDate(record && (record.dateCreated || record.dateCompleted))
  if (recordDate && !isNaN(recordDate.getTime())) {
    return Math.abs(recordDate.getTime() - sentMs) <= 24 * 60 * 60 * 1000
  }

  return false
}

function evaluateProofJobMatch(job, jobId, record, options) {
  var opts = options || {}
  var identity = getStoredProofIdentity(job, jobId)
  var haystack = haystackFromRecord(record)
  var reasons = []
  var score = 0

  if (haystack.indexOf(String(jobId).toLowerCase()) >= 0) {
    score += 50
    reasons.push('jobId')
  }

  if (identity.expected_document_name &&
      haystack.indexOf(identity.expected_document_name.toLowerCase()) >= 0) {
    score += 40
    reasons.push('expected_document_name')
  }

  if (identity.expected_transaction_title &&
      haystack.indexOf(identity.expected_transaction_title.toLowerCase()) >= 0) {
    score += 30
    reasons.push('expected_transaction_title')
  }

  var email = String(identity.signer_email || '').trim().toLowerCase()
  if (email && haystack.indexOf(email) >= 0) {
    score += 15
    reasons.push('signer_email')
  }

  if (isWithinSentAtWindow(identity.sent_at || opts.sentAt, record, opts.nowMs)) {
    score += 10
    reasons.push('sent_at_window')
  }

  var hasStrongIdentifier =
    reasons.indexOf('jobId') >= 0 ||
    reasons.indexOf('expected_document_name') >= 0

  var acceptedForPostSendCapture = hasStrongIdentifier || (
    reasons.indexOf('signer_email') >= 0 &&
    reasons.indexOf('sent_at_window') >= 0
  )

  var acceptedForScannerApply = hasStrongIdentifier || !!opts.manualOverride

  var confidence = score >= 70 ? 'strong' : score >= 40 ? 'medium' : 'weak'

  return {
    score: score,
    confidence: confidence,
    reasons: reasons,
    proof_match_method: reasons.join('+') || 'none',
    proof_match_confidence: confidence,
    expected_document_name: identity.expected_document_name,
    expected_transaction_title: identity.expected_transaction_title,
    acceptedForPostSendCapture: acceptedForPostSendCapture,
    acceptedForScannerApply: acceptedForScannerApply,
    acceptedForNotarization: hasStrongIdentifier,
    manualOverride: !!opts.manualOverride,
  }
}

function buildProofMatchMeta(matchResult) {
  return {
    proof_match_method: matchResult.proof_match_method,
    proof_match_confidence: matchResult.proof_match_confidence,
    proof_matched_at: new Date().toISOString(),
    proof_match_score: matchResult.score,
    proof_match_reasons: matchResult.reasons,
  }
}

module.exports = {
  SENT_AT_MATCH_WINDOW_MS,
  buildExpectedDocumentName,
  buildExpectedTransactionTitle,
  buildSignerMessage,
  buildProofIdentity,
  getStoredProofIdentity,
  haystackFromRecord,
  evaluateProofJobMatch,
  buildProofMatchMeta,
}
