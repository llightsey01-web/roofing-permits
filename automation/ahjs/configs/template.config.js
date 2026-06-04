// TEMPLATE — copy this file to add a new AHJ
// Replace all TODO values before using

module.exports = {
  id: 'TODO_county_id',           // e.g. 'manatee-county'
  name: 'TODO County Building Department',
  state: 'FL',
  portalUrl: 'TODO_portal_login_url',
  loginType: 'accela_legacy',     // or 'accela_angular' or 'custom'
  captchaType: 'recaptcha_v2',    // or 'none'
  captchaSiteKey: 'TODO',
  workflowFile: 'TODO-county.runner.js',
  version: 1,
  lastVerified: 'TODO_DATE',
  permitType: 'TODO_permit_type_label',
  legalDescriptionUrl: 'TODO',
  legalDescriptionType: 'TODO',
  selectors: {
    // TODO — fill in all selectors after portal inspection
    loginEmail: 'TODO',
    loginPassword: 'TODO',
    disclaimerCheckbox: 'TODO',
    disclaimerContinue: 'TODO',
    addressStreetNumber: 'TODO',
    addressStreetName: 'TODO',
    addressCity: 'TODO',
    addressZip: 'TODO',
    searchButton: 'TODO',
    parcelField: 'TODO',
    ownerField: 'TODO',
    saveResumeButton: 'TODO',
  },
  timeouts: {
    login: 30000,
    pageLoad: 15000,
    addressSearch: 90000,
    parcelFill: 10000,
  },
  notes: 'TODO — add any special handling notes here',
}
