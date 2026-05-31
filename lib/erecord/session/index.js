// lib/erecord/session/index.js
// Provider session helpers — re-export provider-specific session modules for automation

function getSessionModule(providerId) {
  if (providerId === 'epn') {
    return require('../../epn/epn-session')
  }
  return null
}

module.exports = {
  getSessionModule,
}
