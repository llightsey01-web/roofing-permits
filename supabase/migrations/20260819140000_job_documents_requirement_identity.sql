-- ZIG-17 PR 1: additive job_documents.ahj_document_requirement_id + partial unique.
-- Forward-only. No backfill. Existing rows stay NULL and are unaffected by the unique index.
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

COMMENT ON COLUMN public.job_documents.ahj_document_requirement_id IS
  'Optional fine-grained AHJ requirement identity for packet-generated documents. NULL for legacy and NOC bridge rows. Unique with job_id only when set.';

COMMIT;
