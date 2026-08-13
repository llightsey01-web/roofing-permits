/**
 * Lake County, FL Building Services — OPRS (NOT Accela).
 *
 * Public inspection 2026-08-13 (no login):
 * - Seeded portal_url https://aca-prod.accela.com/LAKECO is WRONG for Florida.
 *   That tenant is Lake County, California (legacy Accela; OpenGov migration notice).
 * - Real FL portal: Online Plan Review System (OPRS)
 *   https://mcdplus.lakecountyfl.gov/oprs_PT/
 *   iframe → oprswebv2.dll; Google reCAPTCHA gate on public entry.
 * - Official county site (lakecountyfl.gov) points to OPRS for online permitting,
 *   not Accela Citizen Access.
 *
 * loginType: custom — do NOT route through runAccelaPortal / Polk Accela engine.
 * ASI / attachment selectors: N/A until a dedicated OPRS runner is authorized.
 */

module.exports = {
  id: 'lake-county',
  name: 'Lake County Building Department',
  state: 'FL',
  portalUrl: 'https://mcdplus.lakecountyfl.gov/oprs_PT/',
  loginType: 'custom',
  captchaType: 'recaptcha_v2',
  workflowFile: 'lake-county.runner.js',
  workflowType: 'portal',
  credentialKey: 'LAKE_COUNTY',
  sessionProvider: 'lake_oprs',
  permitType: 'Re-Roof Permit',
  version: 1,
  lastVerified: '2026-08-13-public-only',
  loginWaitMs: 3000,
  notes:
    'DEVIATION: not Accela. Seed LAKECO URL was California Accela. FL uses OPRS. ' +
    'Runner is fail-closed until a dedicated OPRS Playwright path is built.',

  selectors: {
    // TODO: OPRS login/apply selectors after authenticated dry run — never guess CapEdit/ASI
    portalEntryUrl: 'https://mcdplus.lakecountyfl.gov/oprs_PT/',
    oprsDllPath: '/oprs_PT/oprswebv2.dll',
    tutorialUrl: 'https://lakecountyfl.gov/building-services/oprs-tutorial',
  },

  defaultValues: {},
  fieldMap: [],
  requiredDocuments: [
    { docType: 'notice_of_commencement', required: true },
    { docType: 'product_approval', required: false },
  ],
  steps: ['login', 'create_application', 'upload_documents', 'submit'],

  quirks: {
    loginMode: 'oprs-custom',
    platform: 'oprs',
    notAccela: true,
    seededUrlWasWrongJurisdiction: true,
    wrongSeedUrl: 'https://aca-prod.accela.com/LAKECO',
    wrongSeedJurisdiction: 'Lake County, California',
    captchaRisk: 'recaptcha_v2_entry_gate',
    use2Captcha: false,
  },

  postSubmitAttachments: {
    confirmedForRoofingPermit: false,
    validatedOn: null,
    notes:
      'OPRS attachments not Accela CapDetail/AttachmentsList — fail closed until OPRS discovery.',
    selectors: {},
  },

  preflightChecks: [
    { field: 'company_id', message: 'Company ID is required' },
    { field: 'ahj_id', message: 'AHJ must be selected for this job' },
  ],
}
