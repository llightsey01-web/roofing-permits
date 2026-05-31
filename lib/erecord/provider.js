// lib/erecord/provider.js
// Base eRecording provider contract

function notImplemented(providerId, method) {
  return {
    success: false,
    skipped: true,
    provider: providerId,
    method: method,
    reason: providerId + '.' + method + ' is not implemented yet',
  }
}

class ErecordProvider {
  constructor(config) {
    this.id = config.id
    this.name = config.name || config.id
  }

  async login(context) {
    return notImplemented(this.id, 'login')
  }

  async createSubmission(context) {
    return notImplemented(this.id, 'createSubmission')
  }

  async uploadDocument(context) {
    return notImplemented(this.id, 'uploadDocument')
  }

  async fillMetadata(context) {
    return notImplemented(this.id, 'fillMetadata')
  }

  async reviewFees(context) {
    return notImplemented(this.id, 'reviewFees')
  }

  async submit(context) {
    return notImplemented(this.id, 'submit')
  }

  async captureSubmissionId(context) {
    return notImplemented(this.id, 'captureSubmissionId')
  }

  async pollStatus(context) {
    return notImplemented(this.id, 'pollStatus')
  }

  async downloadRecordedDocument(context) {
    return notImplemented(this.id, 'downloadRecordedDocument')
  }
}

module.exports = {
  ErecordProvider,
  notImplemented,
}
