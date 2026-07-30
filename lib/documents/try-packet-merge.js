/**
 * Re-evaluate combined packet merge after a document change.
 * Safe to call anytime: no-ops unless job is issued/approved AND all required docs exist.
 */
'use strict'

var { maybeMergeCombinedPacket } = require('./packet-merge')

/**
 * @param {object} supabase - service-role or privileged client
 * @param {string} jobId
 * @param {object} [options]
 * @returns {Promise<{ merged: boolean, reason?: string, filePath?: string, documentId?: string }>}
 */
async function tryPacketMergeForJob(supabase, jobId, options) {
  if (!supabase || !jobId) {
    return { merged: false, reason: 'supabase and jobId required' }
  }

  var jobResult = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobResult.error || !jobResult.data) {
    return { merged: false, reason: (jobResult.error && jobResult.error.message) || 'job not found' }
  }

  try {
    return await maybeMergeCombinedPacket(supabase, jobResult.data, options || {})
  } catch (err) {
    return { merged: false, reason: err.message || String(err) }
  }
}

module.exports = {
  tryPacketMergeForJob,
}
