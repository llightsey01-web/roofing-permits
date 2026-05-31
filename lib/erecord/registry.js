// lib/erecord/registry.js

const { DEFAULT_ERECORD_PROVIDER } = require('./constants')
const ManualProvider = require('./providers/manual')
const EpnProvider = require('./providers/epn')
const SimplifileProvider = require('./providers/simplifile')
const CscProvider = require('./providers/csc')

const providers = {
  manual: new ManualProvider(),
  epn: new EpnProvider(),
  simplifile: new SimplifileProvider(),
  csc: new CscProvider(),
}

function getProvider(providerId) {
  var id = providerId || DEFAULT_ERECORD_PROVIDER
  var provider = providers[id]
  if (!provider) {
    throw new Error('Unknown eRecording provider: ' + id)
  }
  return provider
}

function listProviders() {
  return Object.keys(providers).map(function(id) {
    return { id: id, name: providers[id].name }
  })
}

module.exports = {
  getProvider,
  listProviders,
  providers,
}
