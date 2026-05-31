// worker/verify-noc-trigger.js
// Fail fast if worker would load legacy HTTP NOC trigger code

const fs = require('fs')
const path = require('path')
const { resolveFromRoot } = require('./project-root')

var LEGACY_PATTERNS = [
  { label: 'NOC trigger failed log', re: /NOC trigger failed/ },
  { label: 'webAppUrl + /api/noc/start fetch', re: /fetch\s*\(\s*webAppUrl\s*\+\s*['"]\/api\/noc\/start/ },
  { label: 'direct /api/noc/start fetch in polk runner', re: /fetch\s*\([^)]*\/api\/noc\/start/ },
]

function verifyPolkRunnerUsesDirectTrigger() {
  var polkPath = resolveFromRoot('automation/ahjs/polk-county.runner.js')
  var source = fs.readFileSync(polkPath, 'utf8')

  for (var i = 0; i < LEGACY_PATTERNS.length; i++) {
    if (LEGACY_PATTERNS[i].re.test(source)) {
      throw new Error(
        'Legacy NOC HTTP trigger detected (' + LEGACY_PATTERNS[i].label + ') in ' + polkPath
      )
    }
  }

  if (!source.includes('triggerNocAfterPhase1')) {
    throw new Error(
      'polk-county.runner.js must import triggerNocAfterPhase1 from lib/automation/noc-trigger.js'
    )
  }

  var nocTriggerPath = resolveFromRoot('lib/automation/noc-trigger.js')
  if (!fs.existsSync(nocTriggerPath)) {
    throw new Error('Missing lib/automation/noc-trigger.js')
  }

  return { polkPath: polkPath, nocTriggerPath: nocTriggerPath }
}

module.exports = { verifyPolkRunnerUsesDirectTrigger, LEGACY_PATTERNS }

if (require.main === module) {
  try {
    var result = verifyPolkRunnerUsesDirectTrigger()
    console.log('NOC trigger verification passed')
    console.log('  polk runner:', result.polkPath)
    console.log('  noc trigger:', result.nocTriggerPath)
  } catch (err) {
    console.error('NOC trigger verification failed:', err.message)
    process.exit(1)
  }
}
