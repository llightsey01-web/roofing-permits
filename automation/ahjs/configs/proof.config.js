// automation/ahjs/configs/proof.config.js
// Proof.com RON notarization portal automation config

module.exports = {
    id: 'proof',
    name: 'Proof.com RON Notarization',
    portalUrl: 'https://app.proof.com',
    loginUrl: 'https://app.proof.com/login',
    credentialKey: 'PROOF',
    version: '1.0',
    lastVerified: '2026-05-28',
  
    selectors: {
      // Login
      loginEmail:     'input[name="email"], input[type="email"]',
      loginPassword:  'input[name="password"], input[type="password"]',
      loginSubmit:    'button[type="submit"]',
  
      // New transaction
      newTransactionBtn:  'text=Send request, button:has-text("Send")',
      notarizeOption:     'text=Notarization',
      uploadDocBtn:       'text=Upload a document, input[type="file"]',
  
      // Signer info
      signerFirstName:    'input[name="firstName"], input[placeholder*="First"]',
      signerLastName:     'input[name="lastName"], input[placeholder*="Last"]',
      signerEmail:        'input[name="email"], input[type="email"]',
      signerPhone:        'input[name="phone"], input[type="tel"]',
      smsAuthCheckbox:    'input[type="checkbox"][name*="sms"], label:has-text("SMS")',
  
      // CC contact
      ccEmail:            'input[placeholder*="email"], input[name="ccEmail"]',
  
      // Document editor
      editDocBtn:         'text=Edit document, button:has-text("Edit")',
      signatureField:     '[data-field-type="signature"], .signature-field',
      saveCloseBtn:       'text=Save and close, button:has-text("Save")',
  
      // Send
      sendTransactionBtn: 'button:has-text("Send transaction"), button:has-text("Send")',
    },
  
    // Signature placement on NOC page 2
    // Owner signature line coordinates
    signaturePlacement: {
      page: 2,
      x: 72,
      y: 539,
    },
  }