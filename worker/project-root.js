// worker/project-root.js
// Resolve repo root for worker — supports Docker (/app) and local dev (repo root)

const fs = require('fs')
const path = require('path')

function getProjectRoot() {
  var candidates = [
    __dirname,
    path.join(__dirname, '..'),
  ]

  for (var i = 0; i < candidates.length; i++) {
    var root = candidates[i]
    var polkRunner = path.join(root, 'automation', 'ahjs', 'polk-county.runner.js')
    var nocTrigger = path.join(root, 'lib', 'automation', 'noc-trigger.js')
    if (fs.existsSync(polkRunner) && fs.existsSync(nocTrigger)) {
      return root
    }
  }

  throw new Error(
    'Worker could not locate project automation/lib files. ' +
    'Expected automation/ahjs/polk-county.runner.js and lib/automation/noc-trigger.js'
  )
}

function resolveFromRoot(relativePath) {
  return path.join(getProjectRoot(), relativePath)
}

module.exports = { getProjectRoot, resolveFromRoot }
