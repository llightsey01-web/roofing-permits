// tests/unit/job-status-enum-drift.test.js
// ZIG-8 follow-up: enum-vs-text drift — forward migration + production artifact ordering
'use strict'

const fs = require('fs')
const path = require('path')

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260818001000_job_status_ready_for_physical_submission_enum_safe.sql'
)
var prodPath = path.join(__dirname, '../../scripts/sql/zig-8-production-job-actions.sql')
var rpcMigrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260817191600_job_actions_and_permit_packet_rpc.sql'
)

describe('job_status enum drift follow-up (ZIG-8)', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')
  var rpcMigration = fs.readFileSync(rpcMigrationPath, 'utf8')

  test('forward migration detects enum-backed job_status and adds ready_for_physical_submission', function () {
    expect(migration).toMatch(/data_type/)
    expect(migration).toMatch(/USER-DEFINED/)
    expect(migration).toMatch(/udt_name/)
    expect(migration).toMatch(/typtype = 'e'/)
    expect(migration).toMatch(
      /ALTER TYPE public\.job_status ADD VALUE IF NOT EXISTS ''ready_for_physical_submission''/
    )
    expect(migration).not.toMatch(/ALTER TABLE.*job_status/i)
    expect(migration).not.toMatch(/ALTER COLUMN.*TYPE/)
  })

  test('forward migration no-ops when job_status is text', function () {
    expect(migration).toMatch(/Text-backed column \(staging\): leave unchanged/)
    expect(migration).toMatch(/IS DISTINCT FROM 'USER-DEFINED'/)
    expect(migration).toMatch(/skipping ALTER TYPE/)
    expect(migration).not.toMatch(/CREATE TYPE public\.job_status/)
  })

  test('production artifact places enum addition before PART 2 transaction', function () {
    var part1 = prod.indexOf('-- PART 1')
    var alter = prod.indexOf(
      "ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'ready_for_physical_submission'"
    )
    var part2 = prod.indexOf('-- PART 2')
    var begin = prod.indexOf('\nBEGIN;')
    if (begin < 0) begin = prod.indexOf('BEGIN;')

    expect(part1).toBeGreaterThan(-1)
    expect(alter).toBeGreaterThan(part1)
    expect(part2).toBeGreaterThan(alter)
    expect(begin).toBeGreaterThan(part2)
    expect(prod).toMatch(/Do NOT wrap PART 1 \+ PART 2 in a single transaction/)
  })

  test('enum addition is not inside the same transaction that creates/uses the RPC', function () {
    var alter = prod.indexOf(
      "ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'ready_for_physical_submission'"
    )
    var begin = prod.indexOf('BEGIN;')
    var rpc = prod.indexOf('CREATE OR REPLACE FUNCTION public.complete_permit_packet_skeleton')
    var commit = prod.lastIndexOf('COMMIT;')

    expect(alter).toBeGreaterThan(-1)
    expect(alter).toBeLessThan(begin)
    expect(rpc).toBeGreaterThan(begin)
    expect(commit).toBeGreaterThan(rpc)
    // ALTER TYPE must not appear between BEGIN and COMMIT
    var between = prod.slice(begin, commit)
    expect(between).not.toMatch(/ALTER TYPE public\.job_status/)
  })

  test('existing RPC blocker fix / allowlist / security remain unchanged', function () {
    ;[prod, rpcMigration].forEach(function (src) {
      expect(src).toMatch(
        /AND j\.job_status IN \(\s*'ready',\s*'automation_running',\s*'needs_review',\s*'needs_correction'\s*\)/
      )
      expect(src).toMatch(/permit_packet_invalid_prior_status/)
      expect(src).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT/)
      expect(src).toMatch(/SECURITY DEFINER/)
      expect(src).toMatch(/SET search_path = ''/)
      expect(src).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) TO service_role/
      )
      expect(src).toMatch(
        /REVOKE ALL ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) FROM authenticated/
      )
      expect(src).not.toMatch(/SET status = 'completed'/)
    })
  })
})
