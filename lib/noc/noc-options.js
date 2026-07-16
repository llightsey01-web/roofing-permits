// lib/noc/noc-options.js
// Shared NOC workflow option helpers

const NOC_OPTIONS = {
  AUTO_GENERATE: 'auto_generate',
  UPLOAD_SIGNED: 'upload_signed',
  UPLOAD_NOTARIZED: 'upload_notarized',
  UPLOAD_RECORDED: 'upload_recorded',
  MANUAL_DOWNLOAD: 'manual_download',
}

const UPLOAD_OPTIONS = [
  NOC_OPTIONS.UPLOAD_SIGNED,
  NOC_OPTIONS.UPLOAD_NOTARIZED,
  NOC_OPTIONS.UPLOAD_RECORDED,
]

const UPLOADED_NOC_PATH = function (jobId) {
  return 'jobs/' + jobId + '/uploaded/noc-uploaded.pdf'
}

const MAX_NOC_UPLOAD_BYTES = 10 * 1024 * 1024

function isValidNocOption(value) {
  return Object.values(NOC_OPTIONS).includes(value)
}

function requiresUpload(nocOption) {
  return UPLOAD_OPTIONS.includes(nocOption)
}

function buildJobUpdateForUploadedNoc(job, nocOption, storagePath) {
  var specs = job.job_specs && typeof job.job_specs === 'object' ? Object.assign({}, job.job_specs) : {}
  var update = {
    noc_option: nocOption,
    updated_at: new Date().toISOString(),
  }

  if (nocOption === NOC_OPTIONS.UPLOAD_SIGNED) {
    update.noc_file_path = storagePath
    update.noc_status = 'queued_for_notarization'
    update.noc_generated_at = new Date().toISOString()
  } else if (nocOption === NOC_OPTIONS.UPLOAD_NOTARIZED) {
    update.noc_file_path = job.noc_file_path || storagePath
    update.noc_status = 'queued_for_erecord'
    specs.proof = Object.assign({}, specs.proof || {}, {
      notarized_file_path: storagePath,
      uploaded_at: new Date().toISOString(),
      source: 'contractor_upload',
    })
    update.job_specs = specs
  } else if (nocOption === NOC_OPTIONS.UPLOAD_RECORDED) {
    update.noc_file_path = job.noc_file_path || storagePath
    update.noc_status = 'recorded'
    specs.proof = Object.assign({}, specs.proof || {}, {
      notarized_file_path: (specs.proof && specs.proof.notarized_file_path) || storagePath,
    })
    specs.erecord = Object.assign({}, specs.erecord || {}, {
      recorded_file_path: storagePath,
      status: 'recorded',
      recorded_at: new Date().toISOString(),
      source: 'contractor_upload',
    })
    update.job_specs = specs
  }

  return update
}

function nextRunTypeForNocOption(nocOption) {
  if (nocOption === NOC_OPTIONS.UPLOAD_SIGNED) return 'proof_send'
  if (nocOption === NOC_OPTIONS.UPLOAD_NOTARIZED) return 'erecord_prepare'
  if (nocOption === NOC_OPTIONS.UPLOAD_RECORDED) return 'permit_phase_1'
  return null
}

module.exports = {
  NOC_OPTIONS,
  UPLOAD_OPTIONS,
  UPLOADED_NOC_PATH,
  MAX_NOC_UPLOAD_BYTES,
  isValidNocOption,
  requiresUpload,
  buildJobUpdateForUploadedNoc,
  nextRunTypeForNocOption,
}
