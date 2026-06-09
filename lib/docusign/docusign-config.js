module.exports = {
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
  secretKey: process.env.DOCUSIGN_SECRET_KEY,
  accountId: process.env.DOCUSIGN_ACCOUNT_ID,
  email: process.env.DOCUSIGN_EMAIL,
  password: process.env.DOCUSIGN_PASSWORD,
  privateKeyPath: process.env.DOCUSIGN_PRIVATE_KEY_PATH,
  environment: process.env.DOCUSIGN_ENVIRONMENT || 'sandbox',
  baseUrl: process.env.DOCUSIGN_ENVIRONMENT === 'production'
    ? 'https://na4.docusign.net/restapi'
    : 'https://demo.docusign.net/restapi',
  authUrl: process.env.DOCUSIGN_ENVIRONMENT === 'production'
    ? 'https://account.docusign.com'
    : 'https://account-d.docusign.com',
  oauthBasePath: process.env.DOCUSIGN_ENVIRONMENT === 'production'
    ? 'account.docusign.com'
    : 'account-d.docusign.com',
}
