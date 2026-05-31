// lib/erecord/providers/simplifile.js

const { ErecordProvider } = require('../provider')
const { ERECORD_PROVIDERS } = require('../constants')

class SimplifileProvider extends ErecordProvider {
  constructor() {
    super({ id: ERECORD_PROVIDERS.SIMPLIFILE, name: 'Simplifile' })
  }
}

module.exports = SimplifileProvider
