// lib/erecord/job-specs.js

const { DEFAULT_ERECORD_PROVIDER } = require('./constants')

function recordedStoragePath(jobId) {
  return 'jobs/' + jobId + '/recorded/noc-recorded.pdf'
}

function buildErecordJobSpecs(existingSpecs, erecordMeta) {
  var specs = existingSpecs && typeof existingSpecs === 'object' ? existingSpecs : {}
  return Object.assign({}, specs, { erecord: erecordMeta })
}

function getErecordMeta(job) {
  return job && job.job_specs && job.job_specs.erecord ? job.job_specs.erecord : {}
}

function getProviderFromJob(job) {
  var meta = getErecordMeta(job)
  return meta.provider || DEFAULT_ERECORD_PROVIDER
}

function mergeErecordMeta(job, patch) {
  var existing = getErecordMeta(job)
  return Object.assign({}, existing, patch, {
    provider: patch.provider || existing.provider || DEFAULT_ERECORD_PROVIDER,
  })
}

module.exports = {
  recordedStoragePath,
  buildErecordJobSpecs,
  getErecordMeta,
  getProviderFromJob,
  mergeErecordMeta,
}
