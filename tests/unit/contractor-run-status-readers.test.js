// tests/unit/contractor-run-status-readers.test.js
// ZIG-13 PR 4: contractor-facing surfaces do not classify automation_runs.run_status
'use strict'

const fs = require('fs')
const path = require('path')

function walk(dir, acc) {
  var entries = fs.readdirSync(dir, { withFileTypes: true })
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name)
    if (entries[i].isDirectory()) walk(full, acc)
    else if (/\.(js|jsx)$/.test(entries[i].name)) acc.push(full)
  }
  return acc
}

describe('contractor run_status readers (ZIG-13 PR 4)', function () {
  test('contractor UI and lib do not read automation_runs.run_status', function () {
    var files = walk(path.join(__dirname, '../../app/contractor'), []).concat(
      walk(path.join(__dirname, '../../lib/contractor'), [])
    )
    expect(files.length).toBeGreaterThan(0)
    files.forEach(function (file) {
      var src = fs.readFileSync(file, 'utf8')
      expect(src).not.toMatch(/run_status/)
      expect(src).not.toMatch(/automation_runs/)
    })
  })

  test('contractor APIs that touch automation_runs only enqueue queued writers', function () {
    var jobsRoute = fs.readFileSync(
      path.join(__dirname, '../../app/api/contractor/jobs/route.js'),
      'utf8'
    )
    var uploadRoute = fs.readFileSync(
      path.join(__dirname, '../../app/api/contractor/jobs/[id]/upload-noc/route.js'),
      'utf8'
    )
    expect(jobsRoute).toMatch(/run_status:\s*'queued'/)
    expect(uploadRoute).toMatch(/run_status:\s*'queued'/)
    expect(jobsRoute).not.toMatch(/isSuccessStatus|needs_review|completed/)
    expect(uploadRoute).not.toMatch(/isSuccessStatus|needs_review|completed/)
  })
})
