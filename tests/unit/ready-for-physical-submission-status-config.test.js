// tests/unit/ready-for-physical-submission-status-config.test.js
// ZIG-8: minimal status-config entry (no Draft fallback)
'use strict'

const fs = require('fs')
const path = require('path')

describe('ready_for_physical_submission status-config (ZIG-8)', function () {
  var src = fs.readFileSync(
    path.join(__dirname, '../../lib/contractor/status-config.js'),
    'utf8'
  )

  test('status-config maps ready_for_physical_submission (not Draft fallback)', function () {
    expect(src).toMatch(/ready_for_physical_submission\s*:/)
    expect(src).toMatch(/Ready for physical submission/)
    // Must not only rely on draft fallback for this key
    var draftOnly = /ready_for_physical_submission[\s\S]{0,80}draft/
    expect(src).not.toMatch(draftOnly)
  })

  test('no extra packet micro-statuses in status-config', function () {
    expect(src).not.toMatch(/packet_populated/)
    expect(src).not.toMatch(/packet_assembled/)
    expect(src).not.toMatch(/awaiting_packet/)
  })
})
