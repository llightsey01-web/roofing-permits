// lib/proof/send-noc-to-proof.js
// Downloads completed NOC from storage and sends to Proof.com for homeowner signing

const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

function validateJobForProofSend(job) {
  var reasons = []
  if (job.noc_status !== 'queued_for_notarization') {
    reasons.push('noc_status must be queued_for_notarization (got ' + job.noc_status + ')')
  }
  if (!job.noc_file_path || !String(job.noc_file_path).trim()) {
    reasons.push('noc_file_path is missing')
  }
  if (!job.legal_description || !String(job.legal_description).trim()) {
    reasons.push('legal_description is missing')
  }
  if (!job.owner_email || !String(job.owner_email).trim()) {
    reasons.push('owner_email is missing')
  }
  return reasons
}

function evaluateProofSendGate(job) {
  var reasons = []

  if (!job.parcel_number || !String(job.parcel_number).trim()) {
    reasons.push('parcel_number missing')
  }
  if (!job.legal_description || !String(job.legal_description).trim()) {
    reasons.push('legal_description missing')
  }
  if (!job.portal_confirmation || !String(job.portal_confirmation).trim()) {
    reasons.push('portal_confirmation missing')
  }
  if (!job.noc_file_path || !String(job.noc_file_path).trim()) {
    reasons.push('noc_file_path missing')
  }
  if (!job.owner_email || !String(job.owner_email).trim()) {
    reasons.push('owner_email missing')
  }

  var validationErrors = validateJobForProofSend(job)
  validationErrors.forEach(function(msg) {
    if (reasons.indexOf(msg) < 0) reasons.push(msg)
  })

  return {
    allowed: reasons.length === 0,
    reasons: reasons,
    owner_email: job.owner_email || null,
    pendingCredentialCheck: true,
  }
}

async function validateProofCredentials(companyId) {
  var email = process.env.PROOF_EMAIL
  var password = process.env.PROOF_PASSWORD
  if (!email || !String(email).trim()) {
    return 'Proof credentials missing — email not configured'
  }
  if (!password || !String(password).trim()) {
    return 'Proof credentials missing — password not configured'
  }
  return null
}

async function evaluateProofSendGateAsync(job) {
  var gate = evaluateProofSendGate(job)
  var credentialError = await validateProofCredentials(job.company_id || null)
  if (credentialError) gate.reasons.push(credentialError)
  gate.allowed = gate.reasons.length === 0
  delete gate.pendingCredentialCheck
  return gate
}

async function downloadNocPdf(supabase, nocFilePath) {
  var { data, error } = await supabase.storage.from('job-documents').download(nocFilePath)
  if (error || !data) {
    throw new Error('Failed to download NOC PDF from storage: ' + (error?.message || 'empty file'))
  }
  var pdfBytes = await data.arrayBuffer()
  if (!pdfBytes || pdfBytes.byteLength === 0) {
    throw new Error('Downloaded NOC PDF is empty: ' + nocFilePath)
  }
  return pdfBytes
}

async function sendNocToProof(jobId, options) {
  if (!jobId) throw new Error('Job ID required')
  var opts = options || {}

  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  var gate = await evaluateProofSendGateAsync(job)
  if (!gate.allowed) {
    var skipReason = gate.reasons.join('; ')
    console.log('Skipping Proof send for job ' + jobId + ': ' + skipReason)
    return { success: false, skipped: true, reason: skipReason, gate: gate }
  }

  console.log('Downloading NOC for Proof send: ' + job.noc_file_path)
  var pdfBytes = await downloadNocPdf(supabase, job.noc_file_path)
  console.log('NOC downloaded — ' + pdfBytes.byteLength + ' bytes')

  var { startProofNotarization } = require('../../automation/proof-runner.js')
  return startProofNotarization(jobId, job, pdfBytes, opts)
}

module.exports = {
  validateJobForProofSend,
  validateProofCredentials,
  evaluateProofSendGate,
  evaluateProofSendGateAsync,
  downloadNocPdf,
  sendNocToProof,
}
