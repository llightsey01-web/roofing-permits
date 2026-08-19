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

-- Unique indexes are verify-or-create against pg_catalog identity.
-- IF NOT EXISTS is name-only and would silently accept a same-name wrong index.
-- Mismatched existing indexes fail closed; no DROP/recreate.
CREATE OR REPLACE FUNCTION pg_temp.zig17_pr1_ensure_unique_index(
  p_index_name text,
  p_expected_cols text[],
  p_pred_kind text,
  p_create_sql text
) RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_oid oid;
  v_unique boolean;
  v_valid boolean;
  v_nkeys integer;
  v_pred text;
  v_table_schema text;
  v_table_name text;
  v_cols text[];
  v_labels text[];
  v_pred_norm text;
  v_expected_noc text[] := ARRAY[
    'noc_uploaded_notarized',
    'noc_uploaded_recorded',
    'noc_uploaded_signed',
    'notice_of_commencement'
  ];
BEGIN
  SELECT
    idx.oid,
    i.indisunique,
    i.indisvalid,
    i.indnkeyatts,
    pg_get_expr(i.indpred, i.indrelid),
    ntbl.nspname,
    tbl.relname,
    ARRAY(
      SELECT a.attname::text
      FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = i.indrelid
       AND a.attnum = k.attnum
      ORDER BY k.ord
    )
  INTO
    v_oid,
    v_unique,
    v_valid,
    v_nkeys,
    v_pred,
    v_table_schema,
    v_table_name,
    v_cols
  FROM pg_catalog.pg_class AS idx
  JOIN pg_catalog.pg_namespace AS n ON n.oid = idx.relnamespace
  JOIN pg_catalog.pg_index AS i ON i.indexrelid = idx.oid
  JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
  JOIN pg_catalog.pg_namespace AS ntbl ON ntbl.oid = tbl.relnamespace
  WHERE n.nspname = 'public'
    AND idx.relname = p_index_name;

  IF v_oid IS NULL THEN
    EXECUTE p_create_sql;
    RETURN;
  END IF;

  SELECT coalesce(array_agg(q.lbl ORDER BY q.lbl), ARRAY[]::text[])
  INTO v_labels
  FROM (
    SELECT DISTINCT m[1] AS lbl
    FROM regexp_matches(coalesce(v_pred, ''), e'''([^'']+)''', 'g') AS m
  ) AS q;

  v_pred_norm := regexp_replace(lower(coalesce(v_pred, '')), '[()\s]', '', 'g');

  IF v_table_schema IS DISTINCT FROM 'public'
     OR v_table_name IS DISTINCT FROM 'job_documents'
     OR v_unique IS NOT TRUE
     OR v_valid IS NOT TRUE
     OR v_nkeys IS DISTINCT FROM cardinality(p_expected_cols)
     OR v_cols IS DISTINCT FROM p_expected_cols
     OR v_pred IS NULL
     OR (
          p_pred_kind = 'requirement_not_null'
          AND v_pred_norm IS DISTINCT FROM 'ahj_document_requirement_idisnotnull'
        )
     OR (
          p_pred_kind = 'noc_four_types'
          AND (
            v_pred !~* 'document_type'
            OR v_labels IS DISTINCT FROM v_expected_noc
          )
        )
  THEN
    RAISE EXCEPTION
      'zig17_pr1_index_mismatch: public.% exists but does not match required unique index (table=%.% unique=% valid=% cols=% nkeys=% pred=% labels=%); review required (no automatic drop/recreate)',
      p_index_name,
      v_table_schema,
      v_table_name,
      v_unique,
      v_valid,
      v_cols,
      v_nkeys,
      v_pred,
      v_labels;
  END IF;
END
$fn$;

SELECT pg_temp.zig17_pr1_ensure_unique_index(
  'job_documents_job_id_requirement_id_uidx',
  ARRAY['job_id', 'ahj_document_requirement_id']::text[],
  'requirement_not_null',
  $c$
    CREATE UNIQUE INDEX job_documents_job_id_requirement_id_uidx
      ON public.job_documents (job_id, ahj_document_requirement_id)
      WHERE ahj_document_requirement_id IS NOT NULL;
  $c$
);

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

SELECT pg_temp.zig17_pr1_ensure_unique_index(
  'job_documents_job_id_noc_document_type_uidx',
  ARRAY['job_id', 'document_type']::text[],
  'noc_four_types',
  $c$
    CREATE UNIQUE INDEX job_documents_job_id_noc_document_type_uidx
      ON public.job_documents (job_id, document_type)
      WHERE document_type IN (
        'notice_of_commencement',
        'noc_uploaded_signed',
        'noc_uploaded_notarized',
        'noc_uploaded_recorded'
      );
  $c$
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
