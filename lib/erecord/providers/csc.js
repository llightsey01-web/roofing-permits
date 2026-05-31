// lib/erecord/providers/csc.js

const { ErecordProvider } = require('../provider')
const { ERECORD_PROVIDERS } = require('../constants')

class CscProvider extends ErecordProvider {
  constructor() {
    super({ id: ERECORD_PROVIDERS.CSC, name: 'CSC' })
  }
}

module.exports = CscProvider
