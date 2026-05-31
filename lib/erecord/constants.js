// lib/erecord/constants.js

const ERECORD_PROVIDERS = Object.freeze({
  MANUAL: 'manual',
  EPN: 'epn',
  SIMPLIFILE: 'simplifile',
  CSC: 'csc',
})

const DEFAULT_ERECORD_PROVIDER = ERECORD_PROVIDERS.MANUAL

const ERECORD_PROVIDER_LABELS = Object.freeze({
  manual: 'Manual',
  epn: 'ePN',
  simplifile: 'Simplifile',
  csc: 'CSC',
})

const ERECORD_STATUSES = Object.freeze({
  NOT_STARTED: 'not_started',
  QUEUED: 'queued',
  READY_TO_SEND: 'ready_to_send',
  READY: 'ready',
  SUBMITTED: 'submitted',
  PENDING: 'pending',
  RECORDED: 'recorded',
  REJECTED: 'rejected',
  ERROR: 'error',
})

module.exports = {
  ERECORD_PROVIDERS,
  DEFAULT_ERECORD_PROVIDER,
  ERECORD_PROVIDER_LABELS,
  ERECORD_STATUSES,
}
