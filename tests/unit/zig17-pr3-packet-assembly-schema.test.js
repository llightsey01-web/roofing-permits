// tests/unit/zig17-pr3-packet-assembly-schema.test.js
'use strict'

const fs = require('fs')
const path = require('path')

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260819170000_zig17_pr3_packet_assembly_schema.sql'
)
var prodPath = path.join(
  __dirname,
  '../../scripts/sql/zig-17-pr3-production-packet-assembly-schema.sql'
)

describe('ZIG-17 PR 3 packet assembly schema', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')

  test('adds permit_application and complete enum-safely', function () {
    expect(migration).toMatch(/permit_application/)
    expect(migration).toMatch(/ADD VALUE IF NOT EXISTS ''permit_application''/)
    expect(migration).toMatch(/ADD VALUE IF NOT EXISTS ''complete''/)
    expect(migration).toMatch(/automation_runs\.run_status/)
    expect(migration).toMatch(/skipping ALTER TYPE/)
    expect(migration).not.toMatch(/ADD VALUE IF NOT EXISTS ''completed''/)
  })

  test('unique indexes use verify-or-create, not name-only IF NOT EXISTS', function () {
    expect(migration).toMatch(/zig17_pr3_ensure_unique_index/)
    expect(migration).toMatch(/job_documents_job_id_submission_packet_uidx/)
    expect(migration).toMatch(/review_requests_job_id_pending_packet_incomplete_uidx/)
    expect(migration).toMatch(/WHERE document_type = 'submission_packet'/)
    expect(migration).toMatch(/review_type = 'packet_incomplete'/)
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS job_documents_job_id_submission_packet_uidx/
    )
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS review_requests_job_id_pending_packet_incomplete_uidx/
    )
  })

  test('duplicate preflight fails closed without destructive dedupe', function () {
    expect(migration).toMatch(/no destructive dedupe/)
    expect(migration).toMatch(/refusing UNIQUE \(job_id\) WHERE document_type = submission_packet/)
    expect(migration).toMatch(/refusing UNIQUE \(job_id\) WHERE pending packet_incomplete/)
    expect(migration).not.toMatch(/DELETE FROM public\.job_documents/)
    expect(migration).not.toMatch(/DELETE FROM public\.review_requests/)
  })

  test('production artifact is Logan-manual and matches unique/enum intent', function () {
    expect(prod).toMatch(/FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY/)
    expect(prod).toMatch(/Do not run via agent/)
    expect(prod).toMatch(/ADD VALUE IF NOT EXISTS 'permit_application'/)
    expect(prod).toMatch(/ADD VALUE IF NOT EXISTS 'complete'/)
    expect(prod).toMatch(/job_documents_job_id_submission_packet_uidx/)
    expect(prod).toMatch(/review_requests_job_id_pending_packet_incomplete_uidx/)
    expect(prod).toMatch(/no destructive dedupe/)
    expect(prod).not.toMatch(/ADD VALUE IF NOT EXISTS 'completed'/)
  })
})
