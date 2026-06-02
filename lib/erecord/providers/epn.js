// lib/erecord/providers/epn.js
// ePN provider — save-only package preparation and future live submit

const { ErecordProvider, notImplemented } = require('../provider')
const { ERECORD_PROVIDERS } = require('../constants')
const epnConfig = require('../../../automation/ahjs/configs/erecord/epn.config.js')

class EpnProvider extends ErecordProvider {
  constructor() {
    super({ id: ERECORD_PROVIDERS.EPN, name: epnConfig.name })
    this.config = epnConfig
  }

  async login(context) {
    var { login } = require('../../epn/epn-session')
    var page = context && context.page
    if (!page) return notImplemented(this.id, 'login')
    await login(page)
    return { success: true, url: page.url() }
  }

  async prepareRecordingPackage(context) {
    var { withEpnSession } = require('../../epn/epn-session')
    var { runPrepareEpnPackage } = require('../../epn/prepare-package')

    return withEpnSession(async function(page) {
      return runPrepareEpnPackage(page, context)
    }, {
      headless: !!(context && context.headless),
      slowMo: (context && context.slowMo) || 400,
      companyId: context && context.job ? context.job.company_id : null,
    })
  }

  async fillMetadata(context) {
    var payload = context.payload || {}
    return {
      success: true,
      portalFields: {
        packageName: context.packageName || ('AHJ-IQ NOC - ' + (payload.job_id || '')),
        jurisdiction: payload.county && payload.state
          ? payload.county + ', ' + payload.state
          : 'Polk County, FL',
        parcelNumber: payload.parcel_number,
        documentType: payload.document_type,
      },
    }
  }

  async captureSubmissionId(context) {
    var submissionId = context.submissionId || context.packId || null
    if (!submissionId) return notImplemented(this.id, 'captureSubmissionId')
    return { success: true, submissionId: String(submissionId) }
  }

  async pollStatus(context) {
    var status = context.erecordMeta && context.erecordMeta.status
    if (!status) return notImplemented(this.id, 'pollStatus')
    return { success: true, status: status, provider: this.id }
  }
}

module.exports = EpnProvider
