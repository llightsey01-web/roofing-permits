// lib/erecord/recording-payload.js
// Normalized recording payload — provider adapters translate to portal-specific fields

function buildRecordingPayload(job, jobId) {
  var proof = job && job.job_specs && job.job_specs.proof ? job.job_specs.proof : {}
  var erecord = job && job.job_specs && job.job_specs.erecord ? job.job_specs.erecord : {}

  return {
    job_id: jobId || job.id,
    county: job.property_city ? inferCountyFromJob(job) : null,
    state: job.property_state || null,
    document_type: erecord.document_type || 'notice_of_commencement',
    parcel_number: job.parcel_number || null,
    recording_party: job.owner_name || null,
    return_info: {
      name: job.owner_name || null,
      email: job.owner_email || null,
      address: formatPropertyAddress(job),
    },
    notarized_file_path: proof.notarized_file_path || null,
    property_address: job.property_address || null,
    legal_description: job.legal_description || null,
  }
}

function inferCountyFromJob(job) {
  if (job.property_county) return job.property_county
  var city = String(job.property_city || '').trim()
  if (!city) return null
  return city.indexOf('County') >= 0 ? city : city + ' County'
}

function formatPropertyAddress(job) {
  if (!job) return null
  var parts = [job.property_address, job.property_city, job.property_state, job.property_zip].filter(Boolean)
  return parts.join(', ') || null
}

module.exports = {
  buildRecordingPayload,
  inferCountyFromJob,
  formatPropertyAddress,
}
