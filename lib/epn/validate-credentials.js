// lib/epn/validate-credentials.js

const { getCredential, allowEnvFallback } = require('../credentials/credential-loader')

async function validateEpnCredentials(companyId) {
  try {
    var creds = await getCredential({ provider: 'epn', companyId: companyId || null })
    if (!creds.email || !String(creds.email).trim()) {
      return 'ePN credentials missing — email not configured'
    }
    if (!creds.password || !String(creds.password).trim()) {
      return 'ePN credentials missing — password not configured'
    }
    return null
  } catch (err) {
    if (allowEnvFallback()) {
      return err.message
    }
    return err.message
  }
}

module.exports = { validateEpnCredentials }
