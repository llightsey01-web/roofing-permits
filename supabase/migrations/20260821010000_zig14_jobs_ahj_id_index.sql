-- ZIG-14: Track jobs.ahj_id index parity with production.
-- Staging-first (trimwcwzimfgzgimfwby / dart-iq-staging).
--
-- Phase 0 catalog audit:
--   Production (yhxzwjoouiurxrmhjslg) already has:
--     CREATE INDEX idx_jobs_ahj_id ON public.jobs USING btree (ahj_id)
--   Staging and tracked migrations did not.
--
-- This file records that exact index. Name, table, and column must match
-- live production. Do not rename. Do not add a second jobs.ahj_id index.
-- Does not alter jobs.ahj_id, the foreign key, RLS, or application queries.
-- Idempotent: CREATE INDEX IF NOT EXISTS is a no-op when the name exists.

CREATE INDEX IF NOT EXISTS idx_jobs_ahj_id
ON public.jobs USING btree (ahj_id);
