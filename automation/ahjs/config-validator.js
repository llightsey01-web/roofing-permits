// Validates an AHJ config against the schema
// Call this at worker startup to catch config errors early

const schema = require('./configs/schema.js')

function validateAhjConfig(config) {
  const errors = []
  for (const field of schema.REQUIRED_FIELDS) {
    if (config[field] === undefined || config[field] === null || config[field] === '') {
      errors.push('Missing required field: ' + field)
    }
  }
  if (errors.length > 0) {
    throw new Error('Invalid AHJ config for ' + (config.id || 'unknown') + ': ' + errors.join(', '))
  }
  return true
}

function validateAllConfigs() {
  const configs = [
    require('./configs/polk-county.config.js'),
    require('./configs/lee-county.config.js'),
  ]
  configs.forEach(validateAhjConfig)
  console.log('[config-validator] All ' + configs.length + ' AHJ configs valid')
  return true
}

module.exports = { validateAhjConfig, validateAllConfigs }
