// tests/unit/config-validator.test.js
'use strict'

const { validateAhjConfig } = require('../../automation/ahjs/config-validator.js')
const polkConfig = require('../../automation/ahjs/configs/polk-county.config.js')
const leeConfig = require('../../automation/ahjs/configs/lee-county.config.js')

describe('config-validator', function () {
  test('validateAhjConfig passes for valid Polk config', function () {
    expect(validateAhjConfig(polkConfig)).toBe(true)
  })

  test('validateAhjConfig passes for valid Lee config', function () {
    expect(validateAhjConfig(leeConfig)).toBe(true)
  })

  test('validateAhjConfig throws for missing required fields', function () {
    const invalid = Object.assign({}, polkConfig)
    delete invalid.portalUrl
    expect(function () {
      validateAhjConfig(invalid)
    }).toThrow(/Invalid AHJ config/)
    expect(function () {
      validateAhjConfig(invalid)
    }).toThrow(/Missing required field: portalUrl/)
  })
})
