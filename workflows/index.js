'use strict'

var permit = require('./permit-workflow')
var epn = require('./epn-workflow')

module.exports = {
  permitWorkflow: permit.permitWorkflow,
  buildPermitWorkflow: permit.buildPermitWorkflow,
  startPermitWorkflow: permit.startPermitWorkflow,
  resumePermitWorkflow: permit.resumePermitWorkflow,
  listPermitSteps: permit.listPermitSteps,
  createLegacyActivityDispatcher: permit.createLegacyActivityDispatcher,
  epnWorkflow: epn.epnWorkflow,
  buildEpnWorkflow: epn.buildEpnWorkflow,
  startEpnWorkflow: epn.startEpnWorkflow,
  resumeEpnWorkflow: epn.resumeEpnWorkflow,
  approveEpnReview: epn.approveEpnReview,
  listEpnSteps: epn.listEpnSteps,
  createEpnActivityDispatcher: epn.createEpnActivityDispatcher,
}
