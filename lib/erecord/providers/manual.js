// lib/erecord/providers/manual.js
// Manual recording bridge — operator uploads stamped doc + recording number

const { createClient } = require('@supabase/supabase-js')
const { ErecordProvider } = require('../provider')
const { buildErecordJobSpecs, recordedStoragePath, mergeErecordMeta } = require('../job-specs')
const { ERECORD_PROVIDERS } = require('../constants')

function getSupabase() {
  const ws = require('ws')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

class ManualProvider extends ErecordProvider {
  constructor() {
    super({ id: ERECORD_PROVIDERS.MANUAL, name: 'Manual' })
  }

  async login() {
    return { success: true, skipped: true, reason: 'Manual provider does not require login' }
  }

  async uploadDocument(context) {
    var jobId = context.jobId
    var fileBuffer = context.fileBuffer
    var contentType = context.contentType || 'application/pdf'
    if (!jobId || !fileBuffer) {
      throw new Error('jobId and fileBuffer required for manual upload')
    }
    var supabase = getSupabase()
    var storagePath = recordedStoragePath(jobId)
    var { error } = await supabase.storage.from('job-documents').upload(storagePath, fileBuffer, {
      contentType: contentType,
      upsert: true,
    })
    if (error) throw new Error('Failed to upload recorded NOC: ' + error.message)
    return { success: true, recordedFilePath: storagePath }
  }

  async captureSubmissionId(context) {
    var recordingNumber = context.recordingNumber ? String(context.recordingNumber).trim() : ''
    if (!recordingNumber) throw new Error('recording_number is required')
    return { success: true, submissionId: recordingNumber, recordingNumber: recordingNumber }
  }

  async submit(context) {
    return this.markRecorded(context)
  }

  async markRecorded(context) {
    var jobId = context.jobId
    var recordingNumber = context.recordingNumber ? String(context.recordingNumber).trim() : ''
    var recordingNumberOnly = !!context.recordingNumberOnly
    var recordedFilePath = context.recordedFilePath ? String(context.recordedFilePath).trim() : null
    var recordedBy = context.recordedBy || null

    if (!jobId) throw new Error('Job ID required')
    if (!recordingNumber) throw new Error('recording_number is required')
    if (!recordingNumberOnly && !recordedFilePath) {
      throw new Error('recorded file is required unless recording_number_only is true')
    }

    var supabase = getSupabase()
    var { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', jobId).single()
    if (jobError || !job) throw new Error('Job not found: ' + jobId)

    if (job.noc_status !== 'notarized') {
      throw new Error('Cannot record NOC unless noc_status = notarized (current: ' + job.noc_status + ')')
    }

    var now = new Date().toISOString()
    var erecordMeta = mergeErecordMeta(job, {
      provider: ERECORD_PROVIDERS.MANUAL,
      recording_number: recordingNumber,
      recorded_at: now,
      recorded_file_path: recordedFilePath,
      recording_number_only: recordingNumberOnly,
      recorded_by: recordedBy,
      method: 'manual_bridge',
      status: 'recorded',
    })

    var { data: updatedJob, error: updateError } = await supabase.from('jobs').update({
      noc_status: 'recorded',
      noc_recording_number: recordingNumber,
      noc_recorded_at: now,
      job_specs: buildErecordJobSpecs(job.job_specs, erecordMeta),
    }).eq('id', jobId).select('*').single()

    if (updateError) throw new Error('Failed to update job: ' + updateError.message)

    // Best-effort: resume durable workflows waiting on RecordingFinished
    try {
      var webhooks = require('../../workflow/webhooks.js')
      await webhooks.notifyRecordingFinished({
        provider: 'manual',
        jobId: jobId,
        companyId: updatedJob.company_id || job.company_id || null,
        externalId: recordingNumber || jobId,
        body: {
          job_id: jobId,
          recording_number: recordingNumber,
          recorded_file_path: recordedFilePath,
          source: 'manual_bridge',
        },
      })
    } catch (webhookErr) {
      console.warn('[manual-record] durable webhook notify failed:', webhookErr.message)
    }

    return {
      success: true,
      jobId: jobId,
      nocStatus: 'recorded',
      recordingNumber: recordingNumber,
      recordedFilePath: recordedFilePath,
      recordedAt: now,
      job: updatedJob,
    }
  }

  async pollStatus(context) {
    var supabase = getSupabase()
    var { data: job } = await supabase.from('jobs').select('noc_status, job_specs').eq('id', context.jobId).single()
    if (!job) return { success: false, status: 'unknown' }
    return {
      success: true,
      status: job.noc_status === 'recorded' ? 'recorded' : 'pending',
      erecord: job.job_specs && job.job_specs.erecord ? job.job_specs.erecord : {},
    }
  }

  async downloadRecordedDocument(context) {
    var path = context.recordedFilePath || recordedStoragePath(context.jobId)
    return { success: true, storagePath: path }
  }
}

module.exports = ManualProvider
