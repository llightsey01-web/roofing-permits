-- ZIG-14 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
-- Production execution requires Logan approval.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent intent to:
--   supabase/migrations/20260821010000_zig14_jobs_ahj_id_index.sql
--
-- VERIFIED PRODUCTION FACT (ZIG-14 Phase 0 catalog audit):
--   Production currently already has idx_jobs_ahj_id.
--   CREATE INDEX idx_jobs_ahj_id ON public.jobs USING btree (ahj_id)
--
-- This file is for tracked parity / manual verification only.
-- Expected execution result today: no-op.
-- CREATE INDEX IF NOT EXISTS is name-based; do not rename the live index
-- and do not create a second differently named jobs.ahj_id index.
--
-- Does not:
--   - alter jobs.ahj_id
--   - modify the foreign key
--   - change RLS
--   - rewrite dashboard queries
--
-- No destructive SQL.

-- ============================================================================
-- PREFLIGHT (run first; read-only)
-- ============================================================================

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'jobs'
  AND indexname = 'idx_jobs_ahj_id';
-- Expect today:
--   idx_jobs_ahj_id
--   CREATE INDEX idx_jobs_ahj_id ON public.jobs USING btree (ahj_id)

-- ============================================================================
-- APPLY (idempotent; expected no-op on current production)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_jobs_ahj_id
ON public.jobs USING btree (ahj_id);

-- ============================================================================
-- POST-APPLY VERIFICATION (read-only)
-- ============================================================================

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'jobs'
  AND indexname = 'idx_jobs_ahj_id';
-- Expect the same single btree index on public.jobs (ahj_id).
