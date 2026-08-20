// tests/unit/ready-for-physical-submission-status-config.test.js
// ZIG-8 / ZIG-17 PR 4 Phase H: status maps must not Draft-fallback this status
'use strict'

const fs = require('fs')
const path = require('path')

var CANONICAL_LABEL = 'Ready for physical submission'
var STATUS_KEY = 'ready_for_physical_submission'

var LOCAL_STATUS_MAPS = [
  'app/dashboard/page.js',
  'app/admin/jobs/page.js',
  'app/admin/companies/[id]/page.js',
  'app/jobs/[id]/page.js',
]

var CONTRACTOR_SURFACES = [
  'app/contractor/dashboard/page.js',
  'app/contractor/jobs/[id]/page.js',
]

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(__dirname, '../../', relPath), 'utf8')
}

describe('ready_for_physical_submission status-config (ZIG-8 / ZIG-17 PR 4 Phase H)', function () {
  test('canonical contractor config maps the status with a stable label', function () {
    var src = readRepoFile('lib/contractor/status-config.js')
    expect(src).toMatch(/ready_for_physical_submission\s*:/)
    expect(src).toContain(CANONICAL_LABEL)
    expect(src).not.toMatch(/ready_for_physical_submission[\s\S]{0,80}draft/)
  })

  test('local status maps recognize the status and use the canonical label', function () {
    LOCAL_STATUS_MAPS.forEach(function (relPath) {
      var src = readRepoFile(relPath)
      expect(src).toMatch(new RegExp(STATUS_KEY + '\\s*:'))
      expect(src).toContain(CANONICAL_LABEL)
      expect(src).not.toMatch(
        new RegExp(STATUS_KEY + '[\\s\\S]{0,120}(?:permitStatusConfig|statusColors)\\.draft')
      )
    })
  })

  test('contractor surfaces inherit the canonical config and stay unchanged', function () {
    CONTRACTOR_SURFACES.forEach(function (relPath) {
      var src = readRepoFile(relPath)
      expect(src).toMatch(/lib\/contractor\/status-config/)
      expect(src).toMatch(/permitStatusConfig/)
      expect(src).not.toMatch(/const permitStatusConfig\s*=\s*\{/)
      expect(src).not.toMatch(/ready_for_physical_submission\s*:/)
    })
  })

  test('no extra packet micro-statuses in status-config', function () {
    var src = readRepoFile('lib/contractor/status-config.js')
    expect(src).not.toMatch(/packet_populated/)
    expect(src).not.toMatch(/packet_assembled/)
    expect(src).not.toMatch(/awaiting_packet/)
  })
})
