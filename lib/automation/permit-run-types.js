// lib/automation/permit-run-types.js
// Shared permit-worker claim/execute run_type allowlist (portal + ZIG-8 packet).

'use strict'

var { PERMIT_PACKET_RUN_TYPE } = require('./permit-packet.js')

var PORTAL_PERMIT_RUN_TYPES = [
  'permit_phase_1',
  'permit_resume',
  'permit_submit',
  'permit_document_upload',
]

var PERMIT_RUN_TYPES = PORTAL_PERMIT_RUN_TYPES.concat([PERMIT_PACKET_RUN_TYPE])

/** PostgREST .or() filter: explicit types + legacy null run_type (portal). */
var PERMIT_RUN_TYPE_FILTER =
  'run_type.in.(' +
  PERMIT_RUN_TYPES.join(',') +
  '),run_type.is.null'

var PERMIT_STUCK_RUN_FILTER = PERMIT_RUN_TYPE_FILTER

function isPermitWorkerRunType(runType) {
  if (runType == null || runType === '') return true
  return PERMIT_RUN_TYPES.indexOf(runType) >= 0
}

module.exports = {
  PORTAL_PERMIT_RUN_TYPES: PORTAL_PERMIT_RUN_TYPES,
  PERMIT_RUN_TYPES: PERMIT_RUN_TYPES,
  PERMIT_RUN_TYPE_FILTER: PERMIT_RUN_TYPE_FILTER,
  PERMIT_STUCK_RUN_FILTER: PERMIT_STUCK_RUN_FILTER,
  isPermitWorkerRunType: isPermitWorkerRunType,
  PERMIT_PACKET_RUN_TYPE: PERMIT_PACKET_RUN_TYPE,
}
