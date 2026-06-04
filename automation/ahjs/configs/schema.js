// automation/ahjs/configs/schema.js
// Standard schema for all AHJ portal configs
// Every county config must implement all required fields

module.exports = {
  REQUIRED_FIELDS: [
    'id',           // unique county identifier e.g. 'polk-county'
    'name',         // display name e.g. 'Polk County Building Department'
    'state',        // 'FL'
    'portalUrl',    // login page URL
    'loginType',    // 'accela_legacy' | 'accela_angular' | 'custom'
    'workflowFile', // runner filename e.g. 'polk-county.runner.js'
  ],
  OPTIONAL_FIELDS: [
    'captchaType',          // 'recaptcha_v2' | 'none'
    'captchaSiteKey',       // site key for 2Captcha
    'legalDescriptionUrl',  // property appraiser URL
    'legalDescriptionType', // 'polk_property_appraiser' | 'lee_property_appraiser'
    'permitType',           // permit type label in portal
    'selectors',            // all CSS selectors
    'timeouts',             // step-specific timeouts
    'version',              // config version number
    'lastVerified',         // date config was last verified working
    'notes',                // any special handling notes
    'workflowType',         // legacy: 'portal'
    'credentialKey',        // vault credential key
    'defaultValues',
    'fieldMap',
    'requiredDocuments',
    'steps',
    'quirks',
    'preflightChecks',
    'loginWaitMs',
  ],
}
