// lib/noc/start-noc.js
// Shared NOC phase entry — used by /api/noc/start and automation after parcel save
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { startNOCPipeline } from './noc-pipeline.js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  )
}

export async function startNocPhaseForJob(jobId, options) {
  if (!jobId) {
    const err = new Error('Job ID required')
    err.statusCode = 400
    throw err
  }

  const opts = options || {}

  const supabase = getSupabase()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    const err = new Error('Job not found')
    err.statusCode = 404
    throw err
  }

  if (!job.parcel_number || !String(job.parcel_number).trim()) {
    const err = new Error('Parcel number required before starting NOC')
    err.statusCode = 400
    throw err
  }

  if (!job.portal_confirmation || !String(job.portal_confirmation).trim()) {
    const err = new Error('Portal confirmation required before starting NOC')
    err.statusCode = 400
    throw err
  }

  if (!job.legal_description || !String(job.legal_description).trim()) {
    const err = new Error('Legal description required before starting NOC')
    err.statusCode = 400
    throw err
  }

  console.log('Starting NOC pipeline for job ' + jobId + '...')

  const updatePayload = {
    job_status: 'waiting_for_noc',
  }

  if (job.noc_status === 'error') {
    updatePayload.noc_status = 'not_started'
  }

  const { error: updateError } = await supabase
    .from('jobs')
    .update(updatePayload)
    .eq('id', jobId)

  if (updateError) {
    const err = new Error('Failed to update job: ' + updateError.message)
    err.statusCode = 500
    throw err
  }

  const pipelineResult = await startNOCPipeline(jobId)
  console.log('NOC phase started for job ' + jobId)

  const { createRequire } = await import('module')
  const require = createRequire(import.meta.url)
  const chain = require('../automation/noc-proof-erecord-chain.js')
  const chainResult = await chain.continueAfterNocGenerated(jobId, opts)

  const { data: updatedJob, error: reloadError } = await supabase
    .from('jobs')
    .select('noc_status, noc_file_path')
    .eq('id', jobId)
    .single()

  if (reloadError) {
    const err = new Error('Failed to reload job after NOC pipeline: ' + reloadError.message)
    err.statusCode = 500
    throw err
  }

  return {
    success: true,
    jobId,
    status: 'waiting_for_noc',
    nocStatus: updatedJob.noc_status,
    nocFilePath: updatedJob.noc_file_path,
    pipeline: pipelineResult,
    chain: chainResult,
  }
}
