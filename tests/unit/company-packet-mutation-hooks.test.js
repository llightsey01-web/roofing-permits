// tests/unit/company-packet-mutation-hooks.test.js
// ZIG-17 PR 4 Phase F: company PATCH routes share one packet-field-map helper.
'use strict'

const fs = require('fs')
const path = require('path')

const contractorRoute = fs.readFileSync(
  path.join(__dirname, '../../app/api/contractor/company/route.js'),
  'utf8'
)
const adminRoute = fs.readFileSync(
  path.join(__dirname, '../../app/api/admin/companies/[id]/route.js'),
  'utf8'
)

describe('company packet freshness route wiring', function () {
  test('both PATCH routes call the shared maybeEvaluateCompanyPacketFreshness helper', function () {
    expect(contractorRoute).toMatch(/maybeEvaluateCompanyPacketFreshness/)
    expect(adminRoute).toMatch(/maybeEvaluateCompanyPacketFreshness/)
    expect(contractorRoute).toMatch(/lib\/permits\/packet-freshness/)
    expect(adminRoute).toMatch(/lib\/permits\/packet-freshness/)
  })

  test('routes do not duplicate an independent packet-relevant company field list', function () {
    expect(contractorRoute).not.toMatch(/PACKET_RELEVANT_COMPANY_COLUMNS/)
    expect(adminRoute).not.toMatch(/PACKET_RELEVANT_COMPANY_COLUMNS/)
    expect(contractorRoute).not.toMatch(/company\.full_address/)
    expect(adminRoute).not.toMatch(/company\.full_address/)
  })

  test('admin billing-only fields remain on the PATCH allowlist but are not packet sources', function () {
    expect(adminRoute).toMatch(/subscription_plan/)
    expect(adminRoute).toMatch(/subscription_status/)
    expect(adminRoute).toMatch(/onboarding_status/)
    expect(adminRoute).toMatch(/review_gates/)
    var fieldMap = fs.readFileSync(
      path.join(__dirname, '../../lib/permits/packet-field-map.js'),
      'utf8'
    )
    expect(fieldMap).not.toMatch(/company\.subscription_/)
    expect(fieldMap).not.toMatch(/company\.onboarding_status/)
    expect(fieldMap).not.toMatch(/company\.review_gates/)
  })
})
