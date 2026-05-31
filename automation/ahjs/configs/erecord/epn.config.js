// automation/ahjs/configs/erecord/epn.config.js
// ePN portal config — inspection/automation only (not coupled to NOC business logic)

module.exports = {
  id: 'epn',
  name: 'eRecording Partners Network (ePN)',
  portalUrl: 'https://ep.erecording.com',
  loginUrl: 'https://ep.erecording.com/Login.aspx#/',
  version: '1.0',
  lastVerified: '2026-05-31',
  credentialEnv: {
    email: 'EPN_EMAIL',
    password: 'EPN_PASSWORD',
  },
  selectors: {
    loginEmail: 'input[type="email"], input[name*="Email" i], input[id*="Email" i], input[name*="User" i]',
    loginPassword: 'input[type="password"]',
    loginSubmit: 'input[type="submit"], button[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
    addPackageButton: '#AddPackage-button',
    packageNameInput: '#package-name',
    jurisdictionSearch: '#stateCounty-search',
    packageSearch: '#TextSearchAng',
    addDocumentButton: '#AddDocuments',
    deletePackageButton: '#DeletePkgBtn',
    jurisdictionLink: '#lnkJurisdiction',
  },
  safeLinkPatterns: [
    /dashboard/i, /home/i, /new/i, /create/i, /recording/i, /package/i,
    /history/i, /status/i, /document/i, /upload/i, /county/i, /jurisdiction/i,
    /fee/i, /summary/i, /search/i, /view/i, /list/i,
  ],
  dangerousPatterns: [
    /^submit\b/i, /submit\s*(package|recording|document)/i, /record\s*now/i,
    /finalize/i, /pay\s*now/i, /confirm\s*submit/i, /^send\b/i, /^record\b/i,
  ],
  packageEditor: {
    addPackageButton: '#AddPackage-button',
    packageNameInput: '#package-name',
    jurisdictionSearch: '#stateCounty-search',
    packageSearch: '#TextSearchAng',
  },
}
