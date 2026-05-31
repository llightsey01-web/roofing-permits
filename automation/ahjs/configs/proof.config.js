// automation/ahjs/configs/proof.config.js
// Proof.com RON notarization portal automation config
//
// FROZEN PRODUCTION PLACEMENT — do not edit without re-calibration + approval.
// Single ownerSignature field on page 2 only. No anchor tags. No fallback placement.

const REQUIRED_PROOF_FIELD_COUNT = 1

const FROZEN_OWNER_SIGNATURE = Object.freeze({
  page: 2,
  x: -160,
  y: 590,
  width: 320,
  height: 28,
})

const FROZEN_PROOF_PLACEMENT = Object.freeze({
  ownerSignature: FROZEN_OWNER_SIGNATURE,
})

const FROZEN_FIELD_TOOLS = Object.freeze({
  ownerSignature: Object.freeze({ kind: 'signer', label: 'Sign here' }),
})

module.exports = {
  id: 'proof',
  name: 'Proof.com RON Notarization',
  portalUrl: 'https://business.proof.com',
  loginUrl: 'https://business.proof.com/login',
  newTransactionUrl: 'https://business.proof.com/transaction/new?configId=notarization',
  credentialKey: 'PROOF',
  version: '2.1',
  lastVerified: '2026-05-31',

  REQUIRED_PROOF_FIELD_COUNT: REQUIRED_PROOF_FIELD_COUNT,
  FROZEN_OWNER_SIGNATURE: FROZEN_OWNER_SIGNATURE,
  FROZEN_PROOF_PLACEMENT: FROZEN_PROOF_PLACEMENT,
  FROZEN_FIELD_TOOLS: FROZEN_FIELD_TOOLS,

  // Standard US Letter PDF dimensions (points, origin bottom-left)
  pdfPageSize: Object.freeze({ width: 612, height: 792 }),

  // Production + calibration use identical frozen placement
  proofPlacement: FROZEN_PROOF_PLACEMENT,
  fieldTools: FROZEN_FIELD_TOOLS,

  selectors: {
    loginEmail: 'input[type="email"]',
    loginPassword: 'input[type="password"]',
    uploadDocBtn: 'button',
    saveCloseBtn: 'button',
    sendTransactionBtn: 'button',
  },
}
