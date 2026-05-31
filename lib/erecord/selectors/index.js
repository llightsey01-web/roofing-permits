// lib/erecord/selectors/index.js
// Provider-specific selector configs (automation only — not used in business logic)

const epnConfig = require('../../../automation/ahjs/configs/erecord/epn.config.js')

const selectorConfigs = {
  epn: epnConfig.selectors,
}

function getSelectorsForProvider(providerId) {
  return selectorConfigs[providerId] || null
}

module.exports = {
  getSelectorsForProvider,
  selectorConfigs,
}
