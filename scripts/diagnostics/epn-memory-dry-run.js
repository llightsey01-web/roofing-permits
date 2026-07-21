#!/usr/bin/env node
// scripts/diagnostics/epn-memory-dry-run.js
// Consecutive ePN session dry-runs — measures RSS/heap between browser lifecycles.
// Does NOT create packages, upload documents, or touch #SendPackage.
// Usage: node --expose-gc scripts/diagnostics/epn-memory-dry-run.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.local') })
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'worker', '.env.local') })

const { withEpnSession } = require('../../lib/epn/epn-session')

function memSnapshot(label) {
  var m = process.memoryUsage()
  var row = {
    label: label,
    rssMb: +(m.rss / 1024 / 1024).toFixed(1),
    heapUsedMb: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMb: +(m.heapTotal / 1024 / 1024).toFixed(1),
    externalMb: +(m.external / 1024 / 1024).toFixed(1),
  }
  console.log('[mem]', JSON.stringify(row))
  return row
}

function forceGc() {
  if (typeof global.gc === 'function') global.gc()
}

async function oneDryRun(n) {
  memSnapshot('run-' + n + '-before')
  var result = await withEpnSession(async function (page) {
    // Light portal touch only — no package create / upload / save / send.
    await page.waitForTimeout(800)
    var url = page.url()
    var title = await page.title().catch(function () { return '' })
    return { ok: true, url: url, title: title }
  }, { headless: true, slowMo: 50 })
  forceGc()
  await new Promise(function (r) { setTimeout(r, 1500) })
  forceGc()
  var after = memSnapshot('run-' + n + '-after')
  return { result: result, after: after }
}

async function main() {
  var runs = Number(process.env.EPN_MEM_RUNS || 5)
  console.log('[epn-memory-dry-run] starting', runs, 'consecutive session dry-runs')
  memSnapshot('baseline')
  var samples = []
  for (var i = 1; i <= runs; i++) {
    console.log('\n=== dry-run', i, 'of', runs, '===')
    var row = await oneDryRun(i)
    if (row.result && row.result.skipped) {
      console.error('SKIPPED:', row.result.reason)
      process.exit(2)
    }
    samples.push(row.after)
  }
  console.log('\n=== summary (after each run) ===')
  samples.forEach(function (s, idx) {
    console.log('run', idx + 1, 'rssMb=', s.rssMb, 'heapUsedMb=', s.heapUsedMb)
  })
  var first = samples[0].rssMb
  var last = samples[samples.length - 1].rssMb
  var delta = +(last - first).toFixed(1)
  console.log('rss delta run1→run' + samples.length + ':', delta, 'MB', delta <= 50 ? '(stable/ok)' : '(climbing — investigate)')
}

main().catch(function (err) {
  console.error('FAILED:', err.message)
  process.exit(1)
})
