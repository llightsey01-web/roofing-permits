-- ZIG-17 PR 3 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent intent to:
--   supabase/migrations/20260819170000_zig17_pr3_packet_assembly_schema.sql
--
-- Additive only. No backfill. No destructive dedupe. No RLS policy changes.
--
-- REQUIRED EXECUTION ORDER:
--   PREFLIGHT (read-only) → PART 1 (enum labels, committed) → PART 2 (uniques).
--   PostgreSQL cannot use a newly added enum value until the ADD VALUE
--   transaction commits. Do NOT wrap PART 1 + PART 2 in one transaction.

-- ============================================================================
-- PREFLIGHT (run first; read-only)
-- ============================================================================

-- 1) document_type labels (permit_application may be absent)
SELECT e.enumlabel
FROM pg_catalog.pg_enum AS e
JOIN pg_catalog.pg_type AS t ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname = 'document_type'
ORDER BY e.enumsortorder;

-- 2) run_status labels (complete may already be present from live Worker 2)
SELECT e.enumlabel
FROM pg_catalog.pg_enum AS e
JOIN pg_catalog.pg_type AS t ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname = 'run_status'
ORDER BY e.enumsortorder;

-- 3) Duplicate submission_packet groups — MUST BE ZERO before PART 2
SELECT job_id, count(*) AS n
FROM public.job_documents
WHERE document_type::text = 'submission_packet'
GROUP BY job_id
HAVING count(*) > 1
ORDER BY n DESC, job_id;
-- Expect: 0 rows. If any rows appear → STOP. Do not run PART 2.
-- No automatic dedupe.

-- 4) Duplicate pending packet_incomplete reviews — MUST BE ZERO before PART 2
SELECT job_id, count(*) AS n
FROM public.review_requests
WHERE review_status = 'pending'
  AND review_type = 'packet_incomplete'
GROUP BY job_id
HAVING count(*) > 1
ORDER BY n DESC, job_id;
-- Expect: 0 rows. If any rows appear → STOP. Do not run PART 2.
-- No automatic dedupe.

-- ============================================================================
-- PART 1 — enum labels (own statements; run and confirm before PART 2)
-- ============================================================================
-- Safe to re-run: IF NOT EXISTS.

ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'permit_application';

ALTER TYPE public.run_status ADD VALUE IF NOT EXISTS 'complete';

-- ============================================================================
-- PART 2 — unique indexes (single transaction; run SECOND)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_dup_count
  FROM (
    SELECT jd.job_id
    FROM public.job_documents AS jd
    WHERE jd.document_type::text = 'submission_packet'
    GROUP BY jd.job_id
    HAVING count(*) > 1
  ) AS dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'zig17_pr3_submission_packet: refusing UNIQUE (job_id) WHERE document_type = submission_packet — % duplicate group(s) exist; review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_dup_count
  FROM (
    SELECT rr.job_id
    FROM public.review_requests AS rr
    WHERE rr.review_status = 'pending'
      AND rr.review_type = 'packet_incomplete'
    GROUP BY rr.job_id
    HAVING count(*) > 1
  ) AS dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'zig17_pr3_packet_incomplete_review: refusing UNIQUE (job_id) WHERE pending packet_incomplete — % duplicate group(s) exist; review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.zig17_pr3_ensure_unique_index(
  p_index_name text,
  p_expected_schema text,
  p_expected_table text,
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

  IF v_table_schema IS DISTINCT FROM p_expected_schema
     OR v_table_name IS DISTINCT FROM p_expected_table
     OR v_unique IS NOT TRUE
     OR v_valid IS NOT TRUE
     OR v_nkeys IS DISTINCT FROM cardinality(p_expected_cols)
     OR v_cols IS DISTINCT FROM p_expected_cols
     OR v_pred IS NULL
     OR (
          p_pred_kind = 'submission_packet'
          AND (
            v_pred_norm NOT LIKE '%document_type%'
            OR v_labels IS DISTINCT FROM ARRAY['submission_packet']::text[]
          )
        )
     OR (
          p_pred_kind = 'packet_incomplete_pending'
          AND (
            v_pred_norm NOT LIKE '%review_status%'
            OR v_pred_norm NOT LIKE '%review_type%'
            OR v_labels IS DISTINCT FROM ARRAY['packet_incomplete', 'pending']::text[]
          )
        )
  THEN
    RAISE EXCEPTION
      'zig17_pr3_index_mismatch: public.% exists but does not match required unique index (table=%.% unique=% valid=% cols=% nkeys=% pred=% labels=%); review required (no automatic drop/recreate)',
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

SELECT pg_temp.zig17_pr3_ensure_unique_index(
  'job_documents_job_id_submission_packet_uidx',
  'public',
  'job_documents',
  ARRAY['job_id']::text[],
  'submission_packet',
  $c$
    CREATE UNIQUE INDEX job_documents_job_id_submission_packet_uidx
      ON public.job_documents (job_id)
      WHERE document_type = 'submission_packet';
  $c$
);

SELECT pg_temp.zig17_pr3_ensure_unique_index(
  'review_requests_job_id_pending_packet_incomplete_uidx',
  'public',
  'review_requests',
  ARRAY['job_id']::text[],
  'packet_incomplete_pending',
  $c$
    CREATE UNIQUE INDEX review_requests_job_id_pending_packet_incomplete_uidx
      ON public.review_requests (job_id)
      WHERE review_status = 'pending'
        AND review_type = 'packet_incomplete';
  $c$
);

COMMIT;

-- ============================================================================
-- POST-CHECK (read-only)
-- ============================================================================

SELECT indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'job_documents_job_id_submission_packet_uidx',
    'review_requests_job_id_pending_packet_incomplete_uidx'
  )
ORDER BY indexname;
