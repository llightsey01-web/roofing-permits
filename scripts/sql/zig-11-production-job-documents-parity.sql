-- ZIG-11 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent intent to the production-safe delta of:
--   supabase/migrations/20260818120000_job_documents_canonical_schema.sql
--
-- VERIFIED PRODUCTION FACT (ZIG-11 investigation / architecture review):
--   public.job_documents already has the canonical 9-column runtime shape.
--   public.document_type enum already exists with 16 labels.
--   RLS is enabled with zero policies (intentional).
--
-- Therefore this artifact does NOT:
--   - add columns
--   - convert text → enum
--   - rewrite FKs
--   - recreate the table
--   - add authenticated RLS policies
--
-- Genuine production delta:
--   1) Ensure enum label submission_packet exists (reserved for packet assembly)
--   2) Document intentional zero-policy RLS via table comment
--
-- submission_packet notes:
--   - Reserved for the next packet-assembly issue
--   - No ZIG-11 writer uses it
--   - Settings labels (gl_certificate / wc_certificate / contractor_signature)
--     remain intentionally excluded from the enum

-- ============================================================================
-- PREFLIGHT (run first; read-only)
-- ============================================================================

-- 1) Columns / types / nullability / defaults
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_documents'
ORDER BY ordinal_position;
-- Expect 9 canonical columns; document_type USER-DEFINED / document_type

-- 2) PK / FKs
SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
WHERE n.nspname = 'public'
  AND r.relname = 'job_documents'
ORDER BY c.conname;

-- 3) Indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'job_documents'
ORDER BY indexname;
-- Expect idx_job_docs_job_id and pkey

-- 4) Enum labels / order
SELECT e.enumlabel, e.enumsortorder
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname = 'document_type'
ORDER BY e.enumsortorder;
-- Expect 16 labels today; submission_packet may be absent before PART 2

-- 5) Row count
SELECT count(*) AS job_documents_row_count FROM public.job_documents;

-- 6) RLS + policy count
SELECT c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'job_documents';

SELECT count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'job_documents';
-- Expect rls_enabled=true, policy_count=0

-- 7) Grants (informational)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'job_documents'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

-- ============================================================================
-- PART 2 — production delta (only after preflight matches expectations)
-- ============================================================================
-- Postgres: ADD VALUE may be run in a transaction on modern versions; the new
-- label is not used in this artifact, so commit ordering is safe.

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'submission_packet';

COMMENT ON TABLE public.job_documents IS
  'Per-job document folder artifacts. Direct authenticated/PostgREST access is intentionally denied by RLS with zero policies. Legitimate access occurs through trusted server/service-role paths.';

-- Ensure RLS remains enabled (no policies added — intentional).
ALTER TABLE public.job_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POST-APPLY VERIFICATION
-- ============================================================================

-- Expect submission_packet present:
-- SELECT e.enumlabel
-- FROM pg_enum e
-- JOIN pg_type t ON t.oid = e.enumtypid
-- JOIN pg_namespace n ON n.oid = t.typnamespace
-- WHERE n.nspname = 'public' AND t.typname = 'document_type'
-- ORDER BY e.enumsortorder;

-- Expect policy_count still 0:
-- SELECT count(*) FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'job_documents';

-- Expect comment set:
-- SELECT obj_description('public.job_documents'::regclass);
