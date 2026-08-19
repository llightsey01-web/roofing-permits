-- ZIG-17 PR 1: additive job_documents.ahj_document_requirement_id + partial uniques.
-- Forward-only. No backfill. Existing rows stay NULL on the requirement column.
-- Also adds a NOC-only unique (job_id, document_type) after a fail-closed duplicate precheck.
--
-- Fine-grained future packet identity. Nullable so NOC bridge rows and
-- legacy/settings anti-pattern rows (job_id = companyId) are not forced to
-- attach a fabricated requirement.
--
-- Staging (trimwcwzimfgzgimfwby): apply via migration tooling.
-- Production (yhxzwjoouiurxrmhjslg): Logan executes
--   scripts/sql/zig-17-pr1-production-job-documents-requirement-identity.sql

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

-- Canonical NOC identity: one current row per (job_id, document_type) for the
-- four NOC types only. Does NOT cover other document_type values (settings
-- anti-pattern job_id = companyId stays out of this index).
-- Fail closed if duplicate NOC groups already exist — no automatic dedupe.
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
