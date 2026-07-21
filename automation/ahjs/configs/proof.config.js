// automation/ahjs/configs/proof.config.js
// Proof.com RON notarization portal automation config
//
// FROZEN PRODUCTION PLACEMENT — do not edit without re-calibration + approval.
// Single ownerSignature field. No anchor tags. No fallback placement.
//
// 2026-07-21: Recalibrated from page-2 two-page NOC to page-1 one-page template
// (templates/noc-template.pdf / notice-of-commencement-2023). Coordinates measured
// from the AcroForm owner-signature widget on the one-page layout (best-effort).
// UNVERIFIED against a live Proof.com session — Proof is currently inactive.
// MUST be re-tested with an actual Proof session before notarization_provider is
// ever switched back to 'proof' in production.

const REQUIRED_PROOF_FIELD_COUNT = 1

// Owner signature line on one-page NOC (PDF coords, origin bottom-left).
// Widget approx: x=68, y(bottom)=234, w=395, h=11 → place a taller hit target.
const FROZEN_OWNER_SIGNATURE = Object.freeze({
  page: 1,
  x: 68,
  y: 245,
  width: 395,
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
  version: '2.2',
  lastVerified: '2026-07-21',

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
