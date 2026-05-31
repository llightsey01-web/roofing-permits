#!/usr/bin/env node
// scripts/find-old-noc-triggers.js
// Report remaining legacy NOC HTTP triggers and unsafe response.json() near NOC code

const fs = require('fs')
const path = require('path')

var ROOT = path.join(__dirname, '..')

var SCAN_DIRS = ['automation', 'worker', 'lib', 'app', 'scripts']
var SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'automation/logs'])
var EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.mjs', '.cjs'])

var LEGACY_PATTERNS = [
  { id: 'noc-start-fetch', label: 'fetch to /api/noc/start', re: /fetch\s*\([^)]*\/api\/noc\/start/g },
  { id: 'web-app-url', label: 'webAppUrl variable', re: /\bwebAppUrl\b/g },
  { id: 'noc-trigger-failed', label: 'NOC trigger failed log', re: /NOC trigger failed/g },
  { id: 'railway-default', label: 'Railway production default URL', re: /roofing-permits-production\.up\.railway\.app/g },
]

var CRITICAL_DIRS = ['automation', 'worker', 'lib/automation', 'lib/noc']

var SAFE_HTTP_FILES = new Set([
  path.normalize('lib/automation/noc-trigger.js'),
  path.normalize('automation/test-noc-trigger-after-phase1.js'),
  path.normalize('scripts/find-old-noc-triggers.js'),
  path.normalize('worker/verify-noc-trigger.js'),
])

function isCriticalPath(relative) {
  return CRITICAL_DIRS.some(function(prefix) {
    return relative === prefix || relative.startsWith(prefix + '/')
  })
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return
  for (var entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    var full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full)
  }
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function scanFile(file) {
  var source = fs.readFileSync(file, 'utf8')
  var relative = rel(file)
  var findings = []

  for (var pattern of LEGACY_PATTERNS) {
    pattern.re.lastIndex = 0
    var match
    while ((match = pattern.re.exec(source)) !== null) {
      findings.push({
        file: relative,
        line: lineNumber(source, match.index),
        pattern: pattern.id,
        label: pattern.label,
        snippet: source.slice(match.index, match.index + 120).replace(/\s+/g, ' ').trim(),
      })
    }
  }

  if (/noc|NOC|triggerNoc|startNoc|runPostPhase1/i.test(source)) {
    var jsonRe = /\.json\s*\(\s*\)/g
    var jsonMatch
    while ((jsonMatch = jsonRe.exec(source)) !== null) {
      var windowStart = Math.max(0, jsonMatch.index - 400)
      var windowText = source.slice(windowStart, jsonMatch.index + 20)
      if (/noc|NOC|triggerNoc|startNoc|runPostPhase1|\/api\/noc/i.test(windowText)) {
        findings.push({
          file: relative,
          line: lineNumber(source, jsonMatch.index),
          pattern: 'response-json-near-noc',
          label: 'response.json() near NOC trigger code',
          snippet: windowText.replace(/\s+/g, ' ').trim().slice(-120),
        })
      }
    }
  }

  return findings
}

function main() {
  console.log('Scanning for legacy NOC HTTP triggers...\n')

  var files = []
  for (var dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)

  var allFindings = []
  for (var file of files) {
    allFindings.push.apply(allFindings, scanFile(file))
  }

  var actionable = allFindings.filter(function(f) {
    if (!isCriticalPath(f.file)) return false
    if (f.pattern === 'noc-start-fetch' || f.pattern === 'noc-trigger-failed' || f.pattern === 'web-app-url' || f.pattern === 'railway-default') {
      return !SAFE_HTTP_FILES.has(f.file)
    }
    if (f.pattern === 'response-json-near-noc') {
      return !SAFE_HTTP_FILES.has(f.file)
    }
    return true
  })

  var informational = allFindings.filter(function(f) {
    return !isCriticalPath(f.file)
  })

  if (actionable.length === 0) {
    console.log('✓ No legacy NOC HTTP triggers found in automation/worker paths')
    console.log('✓ polk-county.runner.js should use triggerNocAfterPhase1() direct call')
    if (informational.length) {
      console.log('\nInformational matches outside automation/worker (UI/admin — not NOC trigger paths):')
      for (var info of informational) {
        console.log('  - ' + info.file + ':' + info.line + ' (' + info.label + ')')
      }
    }
    process.exit(0)
  }

  console.log('Found ' + actionable.length + ' potential issue(s):\n')
  for (var finding of actionable) {
    console.log('- ' + finding.file + ':' + finding.line)
    console.log('  ' + finding.label)
    console.log('  ' + finding.snippet)
    console.log('')
  }

  process.exit(1)
}

main()
