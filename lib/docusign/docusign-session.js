'use strict'

const docusign = require('docusign-esign')
const fs = require('fs')
const { join } = require('path')
const config = require('./docusign-config')

function resolvePrivateKeyPath() {
  if (config.privateKeyPath) return config.privateKeyPath
  return join(__dirname, 'private.key')
}

async function getAccessToken(apiClient) {
  apiClient.setOAuthBasePath(config.oauthBasePath)
  var response = await apiClient.requestJWTUserToken(
    config.integrationKey,
    config.email,
    ['signature', 'impersonation'],
    fs.readFileSync(resolvePrivateKeyPath()),
    3600
  )
  return response.body.access_token
}

async function authenticate() {
  var apiClient = new docusign.ApiClient()
  apiClient.setBasePath(config.baseUrl)
  apiClient.addDefaultHeader('Authorization', 'Bearer ' + await getAccessToken(apiClient))
  return apiClient
}

async function sendForNotarization(opts) {
  // opts: { jobId, pdfPath, signerName, signerEmail, signerPhone }
  var apiClient = await authenticate()
  var envelopesApi = new docusign.EnvelopesApi(apiClient)

  var pdfBuffer = fs.readFileSync(opts.pdfPath)
  var pdfBase64 = pdfBuffer.toString('base64')

  var envelopeDefinition = new docusign.EnvelopeDefinition()
  envelopeDefinition.emailSubject = 'Notice of Commencement — Signature Required'
  envelopeDefinition.emailBlurb = 'Please sign your Notice of Commencement document for your roofing permit.'

  var doc = new docusign.Document()
  doc.documentBase64 = pdfBase64
  doc.name = 'Notice of Commencement'
  doc.fileExtension = 'pdf'
  doc.documentId = '1'
  envelopeDefinition.documents = [doc]

  var signer = new docusign.Signer()
  signer.email = opts.signerEmail
  signer.name = opts.signerName
  signer.recipientId = '1'
  signer.routingOrder = '1'

  var signHere = new docusign.SignHere()
  signHere.documentId = '1'
  signHere.pageNumber = '1'
  signHere.xPosition = '100'
  signHere.yPosition = '700'

  var tabs = new docusign.Tabs()
  tabs.signHereTabs = [signHere]
  signer.tabs = tabs

  var recipients = new docusign.Recipients()
  recipients.signers = [signer]
  envelopeDefinition.recipients = recipients
  envelopeDefinition.status = 'sent'

  var results = await envelopesApi.createEnvelope(config.accountId, {
    envelopeDefinition: envelopeDefinition,
  })

  console.log('[docusign] Envelope created:', results.envelopeId)
  return {
    envelopeId: results.envelopeId,
    status: results.status,
  }
}

async function checkEnvelopeStatus(envelopeId) {
  var apiClient = await authenticate()
  var envelopesApi = new docusign.EnvelopesApi(apiClient)
  var result = await envelopesApi.getEnvelope(config.accountId, envelopeId)
  return {
    envelopeId: envelopeId,
    status: result.status,
    completedAt: result.completedDateTime,
  }
}

async function downloadSignedDocument(envelopeId, outputPath) {
  var apiClient = await authenticate()
  var envelopesApi = new docusign.EnvelopesApi(apiClient)
  var result = await envelopesApi.getDocument(config.accountId, envelopeId, '1')
  fs.writeFileSync(outputPath, result)
  console.log('[docusign] Signed document downloaded:', outputPath)
  return outputPath
}

module.exports = {
  sendForNotarization,
  checkEnvelopeStatus,
  downloadSignedDocument,
}
