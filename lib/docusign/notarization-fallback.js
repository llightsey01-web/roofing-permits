'use strict'

/**
 * Worker-only DocuSign fallback entry.
 * Do not import this from Next.js API routes — docusign-esign breaks Turbopack bundling.
 */

async function sendViaDocusign(opts) {
  var docusignSession = require('./docusign-session')
  return docusignSession.sendForNotarization(opts)
}

async function sendForNotarizationWithFallback(opts) {
  var { withProofSession } = require('../proof/proof-session')
  var options = opts || {}
  var attempts = options.attempts || 0

  if (attempts >= 3) {
    console.log('[notary] Proof.com failed 3 times — switching to DocuSign')
    return sendViaDocusign(options)
  }

  try {
    if (!options.pdfBytes || typeof options.handler !== 'function') {
      throw new Error('sendForNotarizationWithFallback requires pdfBytes and handler')
    }
    return await withProofSession(options.pdfBytes, options.handler, options.options || options)
  } catch (err) {
    console.log('[notary] Proof attempt failed: ' + err.message)
    return sendForNotarizationWithFallback(Object.assign({}, options, { attempts: attempts + 1 }))
  }
}

module.exports = {
  sendViaDocusign,
  sendForNotarizationWithFallback,
}
