// lib/erecord/polling/index.js
// Shared polling helpers for provider status checks

const { getProvider } = require('../registry')

async function pollProviderStatus(providerId, context) {
  var provider = getProvider(providerId)
  return provider.pollStatus(context)
}

module.exports = {
  pollProviderStatus,
}
