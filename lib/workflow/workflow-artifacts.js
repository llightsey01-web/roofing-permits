'use strict'

var { createWorkflowState } = require('./workflow-state.js')
var { createWorkflowLogger } = require('./workflow-logger.js')

/**
 * Artifact recorder for screenshots, HTML, LLM I/O, API responses, files.
 */
function createWorkflowArtifacts(options) {
  var opts = options || {}
  var state = opts.state || createWorkflowState({ supabase: opts.supabase })
  var logger = opts.logger || createWorkflowLogger({ state: state })
  var defaultBucket = opts.bucket || 'job-documents'

  async function recordArtifact(input) {
    var i = input || {}
    if (!i.runId) throw new Error('recordArtifact: runId required')
    if (!i.name) throw new Error('recordArtifact: name required')

    var row = {
      run_id: i.runId,
      step_id: i.stepId || null,
      artifact_type: i.artifactType || 'other',
      name: i.name,
      storage_bucket: i.storageBucket || defaultBucket,
      storage_path: i.storagePath || null,
      content_type: i.contentType || null,
      size_bytes: i.sizeBytes != null ? i.sizeBytes : null,
      metadata: i.metadata || {},
    }

    var { data, error } = await state.supabase
      .from('workflow_artifacts')
      .insert(row)
      .select('*')
      .single()

    if (error) throw new Error('recordArtifact: ' + error.message)

    await logger.info('artifact recorded: ' + i.name, {
      artifactId: data.id,
      artifactType: row.artifact_type,
      storagePath: row.storage_path,
    }, { runId: i.runId, stepId: i.stepId })

    return data
  }

  /**
   * Upload a buffer to Storage and record the artifact row.
   */
  async function uploadAndRecord(input) {
    var i = input || {}
    if (!i.runId || !i.storagePath || !i.body) {
      throw new Error('uploadAndRecord: runId, storagePath, body required')
    }

    var bucket = i.storageBucket || defaultBucket
    var { error: uploadError } = await state.supabase.storage
      .from(bucket)
      .upload(i.storagePath, i.body, {
        contentType: i.contentType || 'application/octet-stream',
        upsert: i.upsert !== false,
      })

    if (uploadError) throw new Error('uploadAndRecord: ' + uploadError.message)

    return recordArtifact({
      runId: i.runId,
      stepId: i.stepId,
      artifactType: i.artifactType || 'file',
      name: i.name || i.storagePath.split('/').pop(),
      storageBucket: bucket,
      storagePath: i.storagePath,
      contentType: i.contentType,
      sizeBytes: i.body.length || i.sizeBytes || null,
      metadata: i.metadata || {},
    })
  }

  async function listArtifacts(runId) {
    var { data, error } = await state.supabase
      .from('workflow_artifacts')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true })
    if (error) throw new Error('listArtifacts: ' + error.message)
    return data || []
  }

  return {
    recordArtifact: recordArtifact,
    uploadAndRecord: uploadAndRecord,
    listArtifacts: listArtifacts,
  }
}

module.exports = {
  createWorkflowArtifacts: createWorkflowArtifacts,
}
