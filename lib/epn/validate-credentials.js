// lib/epn/validate-credentials.js

const epnConfig = require('../../automation/ahjs/configs/erecord/epn.config.js')

function validateEpnCredentials() {
  var emailKey = epnConfig.credentialEnv.email
  var passwordKey = epnConfig.credentialEnv.password
  if (!process.env[emailKey] || !String(process.env[emailKey]).trim()) {
    return 'ePN credentials missing — set ' + emailKey + ' in .env.local'
  }
  if (!process.env[passwordKey] || !String(process.env[passwordKey]).trim()) {
    return 'ePN credentials missing — set ' + passwordKey + ' in .env.local'
  }
  return null
}

module.exports = { validateEpnCredentials }
