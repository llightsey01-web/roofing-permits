// lib/proof/proof-job-meta.js
// Lightweight Proof job helpers (no fs/playwright) for automation chain imports

function getProofTransactionId(job) {
  return job?.job_specs?.proof?.transaction_id || null
}

module.exports = {
  getProofTransactionId,
}
