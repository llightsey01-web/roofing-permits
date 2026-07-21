// lib/erecord/service.js
// Provider-aware eRecording orchestration

const { writeFileSync, mkdirSync, unlinkSync, existsSync } = require('fs')
const { join } = require('path')
const { getProvider } = require('./registry')
const { getProviderFromJob, recordedStoragePath, buildErecordJobSpecs, mergeErecordMeta } = require('./job-specs')
const { buildRecordingPayload } = require('./recording-payload')
const { DEFAULT_ERECORD_PROVIDER, ERECORD_PROVIDERS } = require('./constants')
const { createClient } = require('@supabase/supabase-js')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

async function loadJobCompany(supabase, job) {
  if (!job || !job.company_id) return null
  var { data: company } = await supabase
    .from('companies')
    .select('id, name, address, city, state, zip, phone, license_number')
    .eq('id', job.company_id)
    .single()
  return company || null
}

async function downloadNotarizedPdfToLocal(supabase, storagePath, localPdfPath) {
  var { data: pdfBlob, error: dlError } = await supabase.storage.from('job-documents').download(storagePath)
  if (dlError) throw new Error('Failed to download notarized NOC: ' + dlError.message)
  var buffer = Buffer.from(await pdfBlob.arrayBuffer())
  writeFileSync(localPdfPath, buffer)
  buffer = null
  return localPdfPath
}

/**
 * Confirm the notarized source is still present in Supabase Storage before
 * deleting the local copy. Returns false on any uncertainty so cleanup is skipped.
 */
async function confirmNotarizedStillInStorage(supabase, storagePath) {
  if (!storagePath) return false
  var parts = String(storagePath).split('/').filter(Boolean)
  if (!parts.length) return false
  var fileName = parts.pop()
  var folder = parts.join('/')
  var { data, error } = await supabase.storage.from('job-documents').list(folder || '', {
    search: fileName,
    limit: 100,
  })
  if (error || !data) return false
  return data.some(function (item) {
    return item && item.name === fileName
  })
}

/**
 * Remove the large local PDF only after ePN portal upload succeeded AND
 * Supabase still holds the notarized source. Leave JSON audit logs in place.
 * On any failure/uncertainty, leave the PDF on disk for retry.
 */
function cleanupLocalPrepareArtifacts(localPdfPath) {
  try {
    if (localPdfPath && existsSync(localPdfPath)) {
      unlinkSync(localPdfPath)
    }
  } catch (err) {
    console.warn('[erecord] local PDF cleanup skipped:', err.message)
  }
}

async function queueErecordForJob(jobId, options) {
  var opts = options || {}
  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  var providerId = opts.provider || ERECORD_PROVIDERS.EPN
  var now = new Date().toISOString()
  var erecordMeta = mergeErecordMeta(job, {
    provider: providerId,
    status: 'queued',
    queued_at: now,
  })

  var { data: updatedJob, error: updateError } = await supabase.from('jobs').update({
    noc_status: 'queued_for_erecord',
    job_specs: buildErecordJobSpecs(job.job_specs, erecordMeta),
  }).eq('id', jobId).select('*').single()

  if (updateError) throw new Error('Failed to queue eRecording: ' + updateError.message)
  return { success: true, job: updatedJob, erecordMeta: erecordMeta }
}

async function prepareRecordingPackage(jobId, options) {
  var opts = options || {}
  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  var allowedStatuses = ['notarized', 'queued_for_erecord', 'ready_for_erecord_review']
  if (allowedStatuses.indexOf(job.noc_status) < 0) {
    throw new Error('Job noc_status must be notarized, queued_for_erecord, or ready_for_erecord_review (current: ' + job.noc_status + ')')
  }

  var notarizedPath = job.job_specs && job.job_specs.proof ? job.job_specs.proof.notarized_file_path : null
  if (!notarizedPath) throw new Error('Missing job_specs.proof.notarized_file_path')

  var providerId = opts.provider || getProviderFromJob(job)
  if (providerId !== ERECORD_PROVIDERS.EPN) {
    throw new Error('prepareRecordingPackage currently supports epn provider only (got ' + providerId + ')')
  }

  var company = await loadJobCompany(supabase, job)
  if (!company || !company.name) throw new Error('Company name required for grantee party')

  var outputDir = opts.outputDir || join('automation', 'logs', 'epn-prepare-' + jobId + '-' + Date.now())
  mkdirSync(outputDir, { recursive: true })
  var localPdfPath = join(outputDir, 'noc-notarized.pdf')
  await downloadNotarizedPdfToLocal(supabase, notarizedPath, localPdfPath)

  var provider = getProvider(providerId)
  var browserResult = await provider.prepareRecordingPackage({
    job: job,
    jobId: jobId,
    localPdfPath: localPdfPath,
    notarizedFilePath: notarizedPath,
    granteeName: company.name,
    outputDir: outputDir,
    headless: !!opts.headless,
    slowMo: opts.slowMo,
  })

  if (!browserResult || !browserResult.success) {
    throw new Error((browserResult && browserResult.reason) || 'ePN package preparation failed')
  }

  // Only drop the local PDF after portal upload succeeded and Storage still has the source.
  // If upload failed or Storage cannot be confirmed, keep the file for retry.
  if (browserResult.uploadSuccess) {
    var stillInStorage = await confirmNotarizedStillInStorage(supabase, notarizedPath)
    if (stillInStorage) {
      cleanupLocalPrepareArtifacts(localPdfPath)
    } else {
      console.warn('[erecord] keeping local PDF — Supabase Storage source not confirmed:', notarizedPath)
    }
  } else {
    console.warn('[erecord] keeping local PDF — ePN upload did not report success')
  }

  var now = new Date().toISOString()
  var erecordMeta = mergeErecordMeta(job, {
    provider: ERECORD_PROVIDERS.EPN,
    package_id: browserResult.packId,
    package_url: browserResult.packageUrl,
    status: 'ready_to_send',
    ready_at: now,
    estimated_fees: browserResult.estimatedFees || null,
    document_status: browserResult.documentStatus || 'Ready to Send',
    live_submit_required: true,
    prepared_at: now,
    preparation_output_dir: outputDir,
    grantor_name: job.owner_name,
    grantee_name: company.name,
  })

  var { data: updatedJob, error: updateError } = await supabase.from('jobs').update({
    noc_status: 'ready_for_erecord_review',
    job_specs: buildErecordJobSpecs(job.job_specs, erecordMeta),
  }).eq('id', jobId).select('*').single()

  if (updateError) throw new Error('Failed to update job after ePN prep: ' + updateError.message)

  return {
    success: true,
    jobId: jobId,
    job: updatedJob,
    notarizedFilePath: notarizedPath,
    packId: browserResult.packId,
    packageUrl: browserResult.packageUrl,
    packageName: browserResult.packageName,
    uploadSuccess: browserResult.uploadSuccess,
    grantorAddSuccess: browserResult.grantorAddSuccess,
    granteeAddSuccess: browserResult.granteeAddSuccess,
    saveSuccess: browserResult.saveSuccess,
    readyConfirmed: browserResult.readyConfirmed,
    packageStatus: browserResult.packageStatus,
    documentStatus: browserResult.documentStatus,
    estimatedFees: browserResult.estimatedFees,
    sendPackageClicked: false,
    sendPackageVisible: browserResult.sendPackageVisible,
    erecordMeta: erecordMeta,
    outputDir: outputDir,
  }
}

async function recordNocForJob(jobId, options) {
  var opts = options || {}
  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  var providerId = opts.provider || getProviderFromJob(job)
  var provider = getProvider(providerId)
  var payload = buildRecordingPayload(job, jobId)

  if (providerId === 'manual') {
    return provider.markRecorded({
      jobId: jobId,
      recordingNumber: opts.recordingNumber,
      recordingNumberOnly: opts.recordingNumberOnly,
      recordedFilePath: opts.recordedFilePath,
      recordedBy: opts.recordedBy,
      payload: payload,
    })
  }

  throw new Error('Automated recording via ' + providerId + ' is not available yet. Use manual provider.')
}

async function uploadRecordedNocPdf(jobId, fileBuffer, contentType) {
  var provider = getProvider('manual')
  var result = await provider.uploadDocument({
    jobId: jobId,
    fileBuffer: fileBuffer,
    contentType: contentType,
  })
  return result.recordedFilePath
}

async function setJobErecordProvider(jobId, providerId) {
  var provider = getProvider(providerId)
  var supabase = getSupabase()
  var { data: job, error: jobError } = await supabase.from('jobs').select('job_specs').eq('id', jobId).single()
  if (jobError || !job) throw new Error('Job not found: ' + jobId)

  var erecordMeta = mergeErecordMeta(job, { provider: provider.id })
  var { data: updatedJob, error: updateError } = await supabase.from('jobs').update({
    job_specs: buildErecordJobSpecs(job.job_specs, erecordMeta),
  }).eq('id', jobId).select('*').single()

  if (updateError) throw new Error('Failed to update provider: ' + updateError.message)
  return { success: true, provider: provider.id, job: updatedJob }
}

function resolveProviderId(jobOrId, override) {
  if (override) return override
  if (jobOrId && typeof jobOrId === 'object') return getProviderFromJob(jobOrId)
  return DEFAULT_ERECORD_PROVIDER
}

module.exports = {
  recordedStoragePath,
  buildErecordJobSpecs,
  recordNocForJob,
  uploadRecordedNocPdf,
  setJobErecordProvider,
  resolveProviderId,
  buildRecordingPayload,
  getProviderFromJob,
  queueErecordForJob,
  prepareRecordingPackage,
}
