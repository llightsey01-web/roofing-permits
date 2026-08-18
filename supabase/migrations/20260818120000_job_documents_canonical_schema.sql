-- ZIG-11: job_documents + document_type canonical schema ownership.
--
-- This migration establishes tracked canonical ownership of public.job_documents
-- and public.document_type. Prior tracked migration history did not contain their
-- complete original CREATE definitions. This is a forward-only convergence
-- migration, not a replay of historical migrations.
--
-- Canonical document_type labels (17):
--   contractor_license, qualifier_license, insurance_certificate,
--   notice_of_commencement, owners_affidavit, product_approval, site_plan,
--   photo_existing_roof, signed_contract, other, approved_permit,
--   combined_packet, permit_screenshot, noc_uploaded_signed,
--   noc_uploaded_notarized, noc_uploaded_recorded, submission_packet
--
-- Notes:
--   - submission_packet is reserved for the next packet-assembly issue.
--     No ZIG-11 writer uses it.
--   - Settings labels gl_certificate / wc_certificate / contractor_signature are
--     intentionally excluded because that existing path uses the documented
--     job_id = companyId anti-pattern (not valid job_documents document types).
--   - Alias-only labels (noc_recorded, permit_application, roofing_affidavit)
--     remain application aliases in document-folder.js, not DB enum values.
--
-- Environments:
--   Staging may have a 6-column text document_type table and no enum.
--   Production-shaped DBs already have the 9-column enum-backed table.
--   This migration converges both without DROP/recreate.

-- ---------------------------------------------------------------------------
-- 1) Ensure public.document_type enum exists (full canonical set when creating)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'document_type'
      AND t.typtype = 'e'
  ) THEN
    CREATE TYPE public.document_type AS ENUM (
      'contractor_license',
      'qualifier_license',
      'insurance_certificate',
      'notice_of_commencement',
      'owners_affidavit',
      'product_approval',
      'site_plan',
      'photo_existing_roof',
      'signed_contract',
      'other',
      'approved_permit',
      'combined_packet',
      'permit_screenshot',
      'noc_uploaded_signed',
      'noc_uploaded_notarized',
      'noc_uploaded_recorded',
      'submission_packet'
    );
  END IF;
END
$$;

-- When the enum already exists (production), ensure reserved label is present.
-- IF NOT EXISTS is a no-op for labels already on the type. Safe inside a
-- transaction on modern Postgres when the new label is not used in this file.
ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'submission_packet';

-- ---------------------------------------------------------------------------
-- 2) Table foundation (no-op when already present)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  document_type public.document_type NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size_bytes integer NULL,
  mime_type text NULL,
  uploaded_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3) Additive columns for thin staging shape
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS file_size_bytes integer;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS mime_type text;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS uploaded_by uuid;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS file_name text;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS file_path text;

ALTER TABLE public.job_documents
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;

-- Defaults for uploaded_at when column existed as nullable without default
ALTER TABLE public.job_documents
  ALTER COLUMN uploaded_at SET DEFAULT now();

-- ---------------------------------------------------------------------------
-- 4) Convert text document_type → enum when needed (fail closed on bad data)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_data_type text;
  v_udt_name text;
  v_bad_count integer;
  v_null_count integer;
BEGIN
  SELECT c.data_type, c.udt_name
  INTO v_data_type, v_udt_name
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'job_documents'
    AND c.column_name = 'document_type';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'zig11_job_documents: document_type column missing';
  END IF;

  -- Already enum-backed (production-shaped): nothing to convert.
  IF v_data_type = 'USER-DEFINED' AND v_udt_name = 'document_type' THEN
    RAISE NOTICE 'zig11_job_documents: document_type already enum — skipping cast';
    RETURN;
  END IF;

  IF v_data_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION
      'zig11_job_documents: unexpected document_type type %/% — refusing conversion',
      coalesce(v_data_type, '<missing>'),
      coalesce(v_udt_name, '<missing>');
  END IF;

  SELECT count(*)::integer
  INTO v_null_count
  FROM public.job_documents
  WHERE document_type IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION
      'zig11_job_documents: % row(s) have NULL document_type — refusing NOT NULL enum conversion',
      v_null_count;
  END IF;

  SELECT count(*)::integer
  INTO v_bad_count
  FROM public.job_documents AS jd
  WHERE jd.document_type IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_enum AS e
      JOIN pg_catalog.pg_type AS t ON t.oid = e.enumtypid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'document_type'
        AND e.enumlabel = jd.document_type
    );

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'zig11_job_documents: % row(s) have document_type text values not in public.document_type — refusing conversion (no silent rewrite)',
      v_bad_count;
  END IF;

  ALTER TABLE public.job_documents
    ALTER COLUMN document_type TYPE public.document_type
    USING document_type::public.document_type;

  RAISE NOTICE 'zig11_job_documents: converted document_type text → public.document_type';
END
$$;

-- ---------------------------------------------------------------------------
-- 5) Canonical NOT NULL posture (fail closed if unexpected nulls)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE job_id IS NULL) THEN
    RAISE EXCEPTION 'zig11_job_documents: null job_id present — refusing SET NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE document_type IS NULL) THEN
    RAISE EXCEPTION 'zig11_job_documents: null document_type present — refusing SET NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE file_name IS NULL) THEN
    RAISE EXCEPTION 'zig11_job_documents: null file_name present — refusing SET NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE file_path IS NULL) THEN
    RAISE EXCEPTION 'zig11_job_documents: null file_path present — refusing SET NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE uploaded_at IS NULL) THEN
    -- Empty table or nullable legacy column: fill only when all null and zero risk
    UPDATE public.job_documents SET uploaded_at = now() WHERE uploaded_at IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_documents WHERE uploaded_at IS NULL) THEN
    RAISE EXCEPTION 'zig11_job_documents: null uploaded_at present — refusing SET NOT NULL';
  END IF;
END
$$;

ALTER TABLE public.job_documents ALTER COLUMN job_id SET NOT NULL;
ALTER TABLE public.job_documents ALTER COLUMN document_type SET NOT NULL;
ALTER TABLE public.job_documents ALTER COLUMN file_name SET NOT NULL;
ALTER TABLE public.job_documents ALTER COLUMN file_path SET NOT NULL;
ALTER TABLE public.job_documents ALTER COLUMN uploaded_at SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6) Foreign keys (idempotent by constraint name)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'job_documents'
      AND c.conname = 'job_documents_job_id_fkey'
  ) THEN
    ALTER TABLE public.job_documents
      ADD CONSTRAINT job_documents_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'job_documents'
      AND c.conname = 'job_documents_uploaded_by_fkey'
  ) THEN
    ALTER TABLE public.job_documents
      ADD CONSTRAINT job_documents_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7) Index
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_job_docs_job_id
  ON public.job_documents (job_id);

-- ---------------------------------------------------------------------------
-- 8) RLS posture: enabled + zero policies (intentional)
--    Direct authenticated/PostgREST access is intentionally denied by RLS with
--    zero policies. Legitimate access occurs through trusted server/service-role
--    paths. Do not add authenticated tenant policies in ZIG-11.
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.job_documents IS
  'Per-job document folder artifacts. Direct authenticated/PostgREST access is intentionally denied by RLS with zero policies. Legitimate access occurs through trusted server/service-role paths.';
