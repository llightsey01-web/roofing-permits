-- ZIG-10 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent intent to the additive portion of:
--   supabase/migrations/20260818010000_ahj_document_requirements_packet_config.sql
--
-- VERIFIED PRODUCTION FACT:
--   public.ahj_document_requirements already exists with baseline columns + RLS.
--   Do NOT recreate the table or rewrite baseline RLS unnecessarily.
--
-- This artifact only:
--   1) Preflight (read-only)
--   2) Add include_in_submission_packet + source_type (+ CHECK)
--   3) Add UNIQUE (ahj_id, document_role) after duplicate precheck
--
-- If the duplicate precheck finds rows, STOP and review — no destructive dedupe.

-- ============================================================================
-- PREFLIGHT (run first; read-only)
-- ============================================================================

-- 1) Table exists
SELECT to_regclass('public.ahj_document_requirements') AS ahj_document_requirements_regclass;
-- Expect: ahj_document_requirements

-- 2) Current columns
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ahj_document_requirements'
ORDER BY ordinal_position;

-- 3) Duplicate (ahj_id, document_role) groups — MUST BE ZERO before DDL unique index
SELECT ahj_id, document_role, count(*) AS n
FROM public.ahj_document_requirements
GROUP BY ahj_id, document_role
HAVING count(*) > 1
ORDER BY n DESC, ahj_id, document_role;
-- Expect: 0 rows. If any rows appear → STOP. Do not run PART 2.

-- ============================================================================
-- PART 2 — additive DDL (only after preflight is clean)
-- ============================================================================

BEGIN;

ALTER TABLE public.ahj_document_requirements
  ADD COLUMN IF NOT EXISTS include_in_submission_packet boolean NOT NULL DEFAULT true;

ALTER TABLE public.ahj_document_requirements
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'contractor_uploaded';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'ahj_document_requirements'
      AND c.conname = 'ahj_document_requirements_source_type_allowed'
  ) THEN
    ALTER TABLE public.ahj_document_requirements
      ADD CONSTRAINT ahj_document_requirements_source_type_allowed
      CHECK (
        source_type IN (
          'dart_generated',
          'contractor_uploaded',
          'human_obtained'
        )
      );
  END IF;
END
$$;

-- Hard stop inside the transaction if duplicates appeared between preflight and apply
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_dup_count
  FROM (
    SELECT ahj_id, document_role
    FROM public.ahj_document_requirements
    GROUP BY ahj_id, document_role
    HAVING count(*) > 1
  ) AS dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'zig10_packet_config: refusing UNIQUE (ahj_id, document_role) — % duplicate group(s); review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ahj_document_requirements_ahj_id_document_role_uidx
  ON public.ahj_document_requirements (ahj_id, document_role);

COMMIT;

-- Post-apply verification (optional):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='ahj_document_requirements'
--     AND column_name IN ('include_in_submission_packet','source_type');
--   SELECT conname FROM pg_constraint c
--   JOIN pg_class r ON r.oid=c.conrelid
--   JOIN pg_namespace n ON n.oid=r.relnamespace
--   WHERE n.nspname='public' AND r.relname='ahj_document_requirements'
--     AND conname='ahj_document_requirements_source_type_allowed';
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND indexname='ahj_document_requirements_ahj_id_document_role_uidx';
