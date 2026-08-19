-- ZIG-17 PR 1 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent intent to:
--   supabase/migrations/20260819140000_job_documents_requirement_identity.sql
--
-- Additive only. No backfill. No RLS policy changes. No enum changes.

-- ============================================================================
-- PREFLIGHT (run first; read-only)
-- ============================================================================

-- 1) Column present?
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'job_documents'
  AND column_name = 'ahj_document_requirement_id';
-- Expect: 0 rows before apply; uuid/YES after apply

-- 2) Existing job_documents row count (must remain unchanged by this DDL)
SELECT count(*) AS job_documents_row_count FROM public.job_documents;

-- 3) Duplicate canonical NOC groups — MUST BE ZERO before PART 2 unique index
SELECT job_id, document_type::text AS document_type, count(*) AS n
FROM public.job_documents
WHERE document_type IN (
  'notice_of_commencement',
  'noc_uploaded_signed',
  'noc_uploaded_notarized',
  'noc_uploaded_recorded'
)
GROUP BY job_id, document_type
HAVING count(*) > 1
ORDER BY n DESC, job_id, document_type;
-- Expect: 0 rows. If any rows appear → STOP. Do not run PART 2.
-- No automatic dedupe. Review the listed job_id + document_type groups first.

-- ============================================================================
-- PART 2 — additive DDL
-- ============================================================================

BEGIN;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS ahj_document_requirement_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'job_documents'
      AND c.conname = 'job_documents_ahj_document_requirement_id_fkey'
  ) THEN
    ALTER TABLE public.job_documents
      ADD CONSTRAINT job_documents_ahj_document_requirement_id_fkey
      FOREIGN KEY (ahj_document_requirement_id)
      REFERENCES public.ahj_document_requirements(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS job_documents_job_id_requirement_id_uidx
  ON public.job_documents (job_id, ahj_document_requirement_id)
  WHERE ahj_document_requirement_id IS NOT NULL;

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_dup_count
  FROM (
    SELECT jd.job_id, jd.document_type
    FROM public.job_documents AS jd
    WHERE jd.document_type IN (
      'notice_of_commencement',
      'noc_uploaded_signed',
      'noc_uploaded_notarized',
      'noc_uploaded_recorded'
    )
    GROUP BY jd.job_id, jd.document_type
    HAVING count(*) > 1
  ) AS dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'zig17_pr1_noc_identity: refusing UNIQUE (job_id, document_type) for NOC types — % duplicate group(s) exist; review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS job_documents_job_id_noc_document_type_uidx
  ON public.job_documents (job_id, document_type)
  WHERE document_type IN (
    'notice_of_commencement',
    'noc_uploaded_signed',
    'noc_uploaded_notarized',
    'noc_uploaded_recorded'
  );

COMMENT ON COLUMN public.job_documents.ahj_document_requirement_id IS
  'Optional fine-grained AHJ requirement identity for packet-generated documents. NULL for legacy and NOC bridge rows. Unique with job_id only when set.';

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION
-- ============================================================================

-- SELECT column_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='job_documents'
--   AND column_name='ahj_document_requirement_id';
-- Expect: ahj_document_requirement_id | YES
--
-- SELECT conname, pg_get_constraintdef(c.oid)
-- FROM pg_constraint c
-- JOIN pg_class r ON r.oid=c.conrelid
-- JOIN pg_namespace n ON n.oid=r.relnamespace
-- WHERE n.nspname='public' AND r.relname='job_documents'
--   AND conname='job_documents_ahj_document_requirement_id_fkey';
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname='public'
--   AND indexname IN (
--     'job_documents_job_id_requirement_id_uidx',
--     'job_documents_job_id_noc_document_type_uidx'
--   );
-- Expect: requirement unique WHERE ahj_document_requirement_id IS NOT NULL
-- Expect: NOC unique WHERE document_type IN (four NOC labels) only
