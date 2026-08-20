// tests/unit/zig17-pr4-schema.test.js
// ZIG-17 PR 4 Phase A: static schema/RPC contract for physical-submission handoff.
'use strict'

const fs = require('fs')
const path = require('path')

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260820180000_zig17_pr4_physical_submission_handoff.sql'
)
var prodPath = path.join(
  __dirname,
  '../../scripts/sql/zig-17-pr4-production-physical-submission-handoff.sql'
)

function extractFunction(sql, signatureStart) {
  var start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + signatureStart)
  if (start < 0) return ''
  var revoke = sql.indexOf('REVOKE ALL ON FUNCTION public.' + signatureStart, start)
  if (revoke < 0) return sql.slice(start)
  return sql.slice(start, revoke)
}

describe('ZIG-17 PR 4 Phase A physical-submission handoff schema', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')
  var completeFn = extractFunction(migration, 'complete_permit_packet(')
  var skeletonFn = extractFunction(migration, 'complete_permit_packet_skeleton(')
  var invalidateFn = extractFunction(migration, 'invalidate_permit_packet_readiness(')
  var completeProd = extractFunction(prod, 'complete_permit_packet(')
  var skeletonProd = extractFunction(prod, 'complete_permit_packet_skeleton(')
  var invalidateProd = extractFunction(prod, 'invalidate_permit_packet_readiness(')

  test('adds cancelled_at timestamptz NULL', function () {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL/
    )
    expect(prod).toMatch(/ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL/)
  })

  test('allows exactly pending, completed, cancelled', function () {
    expect(migration).toMatch(
      /CONSTRAINT job_actions_status_allowed\s+CHECK \(status IN \('pending', 'completed', 'cancelled'\)\)/
    )
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS job_actions_status_allowed/)
    expect(migration).not.toMatch(
      /CHECK \(status IN \('pending', 'completed'\)\s*\)/
    )
  })

  test('pending/completed/cancelled timestamp consistency CHECK', function () {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS job_actions_completed_fields_consistent/)
    expect(migration).toMatch(/CONSTRAINT job_actions_status_timestamps_consistent/)
    expect(migration).toMatch(
      /status = 'pending'\s+AND completed_at IS NULL\s+AND completed_by IS NULL\s+AND cancelled_at IS NULL/
    )
    expect(migration).toMatch(
      /status = 'completed'\s+AND completed_at IS NOT NULL\s+AND cancelled_at IS NULL/
    )
    expect(migration).toMatch(
      /status = 'cancelled'\s+AND cancelled_at IS NOT NULL\s+AND completed_at IS NULL\s+AND completed_by IS NULL/
    )
  })

  test('completed + completed_at + null completed_by remains schema-valid by design', function () {
    var checkBlock = migration.match(
      /CONSTRAINT job_actions_status_timestamps_consistent\s+CHECK \(([\s\S]*?)\);/
    )
    expect(checkBlock).not.toBeNull()
    var completedArm = checkBlock[1].match(
      /status = 'completed'[\s\S]*?status = 'cancelled'/
    )
    expect(completedArm).not.toBeNull()
    expect(completedArm[0]).toMatch(/completed_at IS NOT NULL/)
    expect(completedArm[0]).toMatch(/cancelled_at IS NULL/)
    expect(completedArm[0]).not.toMatch(/completed_by IS NOT NULL/)
    expect(completedArm[0]).not.toMatch(/completed_by IS NULL/)
    expect(prod).toMatch(
      /status = 'completed'\s+AND completed_at IS NOT NULL\s+AND cancelled_at IS NULL/
    )
  })

  test('cancelled always requires cancelled_at and cannot have completed_at or completed_by', function () {
    expect(migration).toMatch(
      /status = 'cancelled'\s+AND cancelled_at IS NOT NULL\s+AND completed_at IS NULL\s+AND completed_by IS NULL/
    )
    expect(prod).toMatch(
      /status = 'cancelled'\s+AND cancelled_at IS NOT NULL\s+AND completed_at IS NULL\s+AND completed_by IS NULL/
    )
  })

  test('no legacy completed-by-null rejection or backfill exists', function () {
    expect(migration).not.toMatch(/completed row\(s\) have completed_by NULL/)
    expect(migration).not.toMatch(/no destructive backfill/)
    expect(migration).not.toMatch(/UPDATE public\.job_actions[\s\S]{0,200}completed_by/)
    expect(prod).not.toMatch(/completed row\(s\) have completed_by NULL/)
    expect(prod).not.toMatch(/Expect 0\. New completed CHECK requires completed_by/)
    expect(prod).toMatch(/completed actions may have completed_by NULL \(do not backfill\)/)
  })

  test('existing pending physical-submission unique index remains pending-only', function () {
    expect(migration).toMatch(/job_actions_one_pending_physical_submission_idx/)
    expect(migration).toMatch(/p_pred_kind = 'physical_submission_pending'/)
    expect(migration).toMatch(/ARRAY\['pending', 'physical_submission'\]/)
    expect(migration).toMatch(/p_must_exist boolean/)
    expect(migration).toMatch(
      /zig17_pr4_index_missing: public\.% is required and was not found/
    )
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? job_actions_one_pending_physical_submission_idx/
    )
    expect(migration).not.toMatch(
      /WHERE action_type = 'physical_submission' AND status IN \('pending', 'cancelled'\)/
    )
  })

  test('active permit_packet unique-index keys and predicate', function () {
    var indexCreate =
      /CREATE UNIQUE INDEX automation_runs_one_active_permit_packet_uidx\s+ON public\.automation_runs \(job_id\)\s+WHERE run_type = 'permit_packet'\s+AND run_status IN \('queued', 'running'\);/
    expect(migration).toMatch(/automation_runs_one_active_permit_packet_uidx/)
    expect(migration).toMatch(/ON public\.automation_runs \(job_id\)/)
    expect(migration).toMatch(indexCreate)
    expect(prod).toMatch(indexCreate)
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX automation_runs_one_active_permit_packet_uidx[\s\S]*?run_status::text/
    )
    expect(prod).not.toMatch(
      /CREATE UNIQUE INDEX automation_runs_one_active_permit_packet_uidx[\s\S]*?run_status::text/
    )
    expect(migration).toMatch(/p_pred_kind = 'active_permit_packet'/)
    expect(migration).toMatch(/ARRAY\['permit_packet', 'queued', 'running'\]/)
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_one_active_permit_packet_uidx/
    )
  })

  test('duplicate preflight exists and is fail-closed without destructive dedupe', function () {
    expect(migration).toMatch(/refusing UNIQUE \(job_id\) WHERE active permit_packet/)
    expect(migration).toMatch(/no destructive dedupe/)
    expect(migration).toMatch(/no automatic drop\/recreate/)
    expect(migration).toMatch(/Do not compare raw pg_get_indexdef/)
    expect(migration).not.toMatch(/DELETE FROM public\.job_actions/)
    expect(migration).not.toMatch(/DELETE FROM public\.automation_runs/)
    expect(prod).toMatch(/no destructive dedupe/)
    expect(prod).not.toMatch(/DELETE FROM public\.job_actions/)
    expect(prod).not.toMatch(/DELETE FROM public\.automation_runs/)
  })

  test('ready RPC signature, SECURITY DEFINER, empty search_path, service-role-only', function () {
    expect(completeFn).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_permit_packet\(\s*p_job_id uuid,\s*p_fingerprint jsonb\s*\)/
    )
    expect(completeFn).toMatch(/RETURNS jsonb/)
    expect(completeFn).toMatch(/SECURITY DEFINER/)
    expect(completeFn).toMatch(/SET search_path = ''/)
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_permit_packet\(uuid, jsonb\) FROM PUBLIC/
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_permit_packet\(uuid, jsonb\) FROM anon/
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_permit_packet\(uuid, jsonb\) FROM authenticated/
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_permit_packet\(uuid, jsonb\) TO service_role/
    )
  })

  test('fingerprint validation and allowed prior statuses', function () {
    expect(completeFn).toMatch(/fingerprint\.version must be 1/)
    expect(completeFn).toMatch(/lowercase 64-char hex/)
    expect(completeFn).toMatch(/\^\[0-9a-f\]\{64\}\$/)
    expect(completeFn).toMatch(/fingerprint\.computed_at is required/)
    expect(completeFn).toMatch(/fingerprint\.computed_at is invalid/)
    expect(completeFn).toMatch(/isfinite\(\(p_fingerprint ->> 'computed_at'\)::timestamptz\)/)
    expect(completeFn).toMatch(/fingerprint\.artifacts must be a JSON array/)
    expect(completeFn).toMatch(/canonical submission_packet is required/)
    expect(completeFn).toMatch(/job_specs\.packet\.complete must be true/)
    expect(completeFn).toMatch(/FOR UPDATE/)
    expect(completeFn).toMatch(/IS DISTINCT FROM 'ready'/)
    expect(completeFn).toMatch(/automation_running/)
    expect(completeFn).toMatch(/needs_review/)
    expect(completeFn).toMatch(/needs_correction/)
    expect(completeFn).toMatch(/ready_for_physical_submission/)
    expect(completeFn).toMatch(/permit_packet_invalid_prior_status/)
    expect(completeFn).not.toMatch(/v_status IS DISTINCT FROM 'draft'/)
  })

  test('same-fingerprint idempotency and mismatched already-ready no-clobber', function () {
    expect(completeFn).toMatch(/noop_reason', 'ready_fingerprint_mismatch'/)
    expect(completeFn).toMatch(/action_created', v_created/)
    expect(completeFn).toMatch(/action_created', false/)
    var mismatchIdx = completeFn.indexOf("noop_reason', 'ready_fingerprint_mismatch'")
    var writeIdx = completeFn.indexOf("job_specs = v_specs || jsonb_build_object('packet', v_packet)")
    expect(mismatchIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(mismatchIdx)
    var mismatchSlice = completeFn.slice(0, mismatchIdx)
    expect(mismatchSlice).not.toMatch(/SET\s+job_status = 'ready_for_physical_submission'/)
    expect(mismatchSlice).not.toMatch(/status = 'cancelled'/)
    expect(completeFn).toMatch(/jsonb_build_object\('packet', v_packet\)/)
    expect(completeFn).toMatch(/v_packet - 'stale'/)
    expect(completeFn).toMatch(/fingerprint_history/)
    expect(completeFn).toMatch(/ON CONFLICT \(job_id\) WHERE/)
    expect(completeFn).not.toMatch(/digest\s*\(/)
    expect(completeFn).not.toMatch(/sha256\s*\(/i)
    expect(completeFn).not.toMatch(/storage\.from/)
  })

  test('invalidation CAS and cancelled action semantics', function () {
    expect(invalidateFn).toMatch(
      /CREATE OR REPLACE FUNCTION public\.invalidate_permit_packet_readiness\(\s*p_job_id uuid,\s*p_expected_stored_input_fingerprint text,\s*p_expect_missing_stored_fingerprint boolean,\s*p_observed_input_fingerprint text,\s*p_reason text\s*\)/
    )
    expect(invalidateFn).toMatch(/SECURITY DEFINER/)
    expect(invalidateFn).toMatch(/SET search_path = ''/)
    expect(invalidateFn).toMatch(/FOR UPDATE/)
    expect(invalidateFn).toMatch(/noop_reason', 'not_ready'/)
    expect(invalidateFn).toMatch(/noop_reason', 'fingerprint_cas_mismatch'/)
    expect(invalidateFn).toMatch(/#>> '\{fingerprint,input_fingerprint\}'/)
    expect(invalidateFn).toMatch(/p_expect_missing_stored_fingerprint/)
    expect(invalidateFn).toMatch(/\^\[0-9a-f\]\{64\}\$/)
    expect(invalidateFn).toMatch(/v_stored_valid/)
    expect(invalidateFn).toMatch(/v_stored_input IS DISTINCT FROM v_expected/)
    expect(invalidateFn).toMatch(/job_status = 'needs_correction'/)
    expect(invalidateFn).toMatch(/'complete', false/)
    expect(invalidateFn).toMatch(/'stale'/)
    expect(invalidateFn).toMatch(/invalidated_at/)
    expect(invalidateFn).toMatch(/expected_stored_input_fingerprint/)
    expect(invalidateFn).toMatch(/observed_input_fingerprint/)
    expect(invalidateFn).toMatch(/status = 'cancelled'/)
    expect(invalidateFn).toMatch(/cancelled_at = now\(\)/)
    expect(invalidateFn).toMatch(/AND ja\.status = 'pending'/)
    expect(invalidateFn).not.toMatch(/completed_by\s*=/)
    expect(invalidateFn).not.toMatch(/completed_at\s*=/)
    expect(invalidateFn).not.toMatch(/status = 'completed'/)
    expect(migration).toMatch(
      /DROP FUNCTION IF EXISTS public\.invalidate_permit_packet_readiness\(uuid, text, text, text\)/
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.invalidate_permit_packet_readiness\(uuid, text, boolean, text, text\) TO service_role/
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.invalidate_permit_packet_readiness\(uuid, text, boolean, text, text\) FROM authenticated/
    )
  })

  test('missing-fingerprint CAS fails closed on invalid parameter combinations', function () {
    expect(invalidateFn).toMatch(
      /p_expect_missing_stored_fingerprint cannot be combined with a non-empty expected fingerprint/
    )
    expect(invalidateFn).toMatch(
      /p_expected_stored_input_fingerprint must be lowercase 64-char hex when p_expect_missing_stored_fingerprint is false/
    )
    expect(invalidateFn).toMatch(
      /p_expect_missing_stored_fingerprint is required/
    )
    var missingModeIdx = invalidateFn.indexOf(
      'p_expect_missing_stored_fingerprint cannot be combined with a non-empty expected fingerprint'
    )
    var casMismatchIdx = invalidateFn.indexOf("noop_reason', 'fingerprint_cas_mismatch'")
    expect(missingModeIdx).toBeGreaterThan(-1)
    expect(casMismatchIdx).toBeGreaterThan(missingModeIdx)
    expect(invalidateFn).toMatch(/IF p_expect_missing_stored_fingerprint IS TRUE THEN/)
    expect(invalidateFn).toMatch(/IF v_stored_valid THEN/)
  })

  test('skeleton no longer contains ready transition logic', function () {
    expect(skeletonFn).toMatch(/complete_permit_packet_skeleton is retired/)
    expect(skeletonFn).toMatch(/use complete_permit_packet\(p_job_id, p_fingerprint\)/)
    expect(skeletonFn).toMatch(/SECURITY DEFINER/)
    expect(skeletonFn).toMatch(/SET search_path = ''/)
    expect(skeletonFn).not.toMatch(/SET job_status/)
    expect(skeletonFn).not.toMatch(/INSERT INTO public\.job_actions/)
    expect(skeletonFn).not.toMatch(/FOR UPDATE/)
    expect(skeletonFn).not.toMatch(/ready_for_physical_submission/)
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) TO service_role/
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) FROM authenticated/
    )
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_permit_packet_skeleton\(uuid\) FROM PUBLIC/
    )
  })

  test('production SQL is Logan-manual and matches staging semantics', function () {
    expect(prod).toMatch(/FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY/)
    expect(prod).toMatch(/Do not run via agent/)
    expect(prod).toMatch(/20260820180000_zig17_pr4_physical_submission_handoff\.sql/)
    expect(completeProd.length).toBeGreaterThan(200)
    expect(skeletonProd).toMatch(/complete_permit_packet_skeleton is retired/)
    expect(skeletonProd).not.toMatch(/INSERT INTO public\.job_actions/)
    expect(invalidateProd).toMatch(/fingerprint_cas_mismatch/)
    expect(prod).toMatch(/cancelled_at timestamptz NULL/)
    expect(prod).toMatch(/job_actions_status_timestamps_consistent/)
    expect(prod).toMatch(/automation_runs_one_active_permit_packet_uidx/)
    expect(prod).toMatch(/complete_permit_packet\(\s*p_job_id uuid,\s*p_fingerprint jsonb\s*\)/)
    expect(prod).toMatch(/ready_fingerprint_mismatch/)
    expect(prod).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_permit_packet\(uuid, jsonb\) TO service_role/)
    expect(prod).toMatch(/GRANT EXECUTE ON FUNCTION public\.invalidate_permit_packet_readiness\(uuid, text, boolean, text, text\) TO service_role/)
    expect(prod).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_one_active_permit_packet_uidx/)
  })
})
