// tests/unit/admin-operations.test.js
// ZIG-13 PR 4: admin operations UI/API run-status semantics
'use strict'

const fs = require('fs')
const path = require('path')
const { getRunStatusPresentation } = require('../../lib/automation/run-status.js')

var PAGE_SRC = fs.readFileSync(
  path.join(__dirname, '../../app/admin/operations/page.js'),
  'utf8'
)
var ROUTE_SRC = fs.readFileSync(
  path.join(__dirname, '../../app/api/admin/operations/route.js'),
  'utf8'
)

describe('admin operations run-status readers (ZIG-13 PR 4)', function () {
  test('needs_review renders as Needs review, not Failed', function () {
    expect(getRunStatusPresentation('needs_review').label).toBe('Needs review')
    expect(getRunStatusPresentation('needs_review').kind).toBe('intervention')
    expect(getRunStatusPresentation('error').label).toBe('Failed')
    expect(getRunStatusPresentation('complete').label).toBe('Success')
    expect(getRunStatusPresentation('completed').label).toBe('Success')
    expect(getRunStatusPresentation('failed').label).toBe('Failed')
    expect(getRunStatusPresentation('cancelled').label).toBe('Cancelled')
    expect(getRunStatusPresentation('queued').label).toBe('Queued')
    expect(getRunStatusPresentation('running').label).toBe('Running')
    expect(PAGE_SRC).toMatch(/getRunStatusPresentation/)
    expect(PAGE_SRC).not.toMatch(/runStatus === 'error' \|\| runStatus === 'needs_review'/)
    expect(PAGE_SRC).toMatch(/NEEDS REVIEW TODAY/)
  })

  test('operations API counts success, failure, and intervention separately', function () {
    expect(ROUTE_SRC).toMatch(/SUCCESS_READ_STATUSES/)
    expect(ROUTE_SRC).toMatch(/FAILURE_READ_STATUSES/)
    expect(ROUTE_SRC).toMatch(/INTERVENTION_READ_STATUSES/)
    expect(ROUTE_SRC).toMatch(/needsReviewRuns/)
    expect(ROUTE_SRC).toMatch(/RUN_STATUS_NEEDS_REVIEW/)
    expect(ROUTE_SRC).not.toMatch(/\.eq\('run_status', 'complete'\)/)
    expect(ROUTE_SRC).not.toMatch(/\.eq\('run_status', 'error'\)/)
  })
})
