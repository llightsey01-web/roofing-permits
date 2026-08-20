-- ZIG-17 PR 4 Phase A: physical-submission handoff schema + atomic RPCs.
-- Forward-only. No backfill. No destructive dedupe. No RLS policy changes.
-- Does not download Storage or hash packet bytes.
--
-- Adds:
--   - job_actions.cancelled_at
--   - cancelled action status + timestamp CHECKs
--   - unique (job_id) WHERE active permit_packet run (queued|running)
--   - complete_permit_packet(p_job_id, p_fingerprint)
--   - invalidate_permit_packet_readiness(...)
--   - retires complete_permit_packet_skeleton as a compatibility failure
--
-- Unique indexes are verify-or-create against pg_catalog identity (PR 3 pattern):
-- compare table/cols/unique/valid + predicate column names + quoted labels.
-- Do not compare raw pg_get_indexdef() strings (text vs enum casts render differently).
-- IF NOT EXISTS is name-only and would silently accept a same-name wrong index.
-- Mismatched existing indexes fail closed; no DROP/recreate.
-- The ZIG-8 pending physical_submission unique index is verified, not recreated.
--
-- Staging (trimwcwzimfgzgimfwby): apply via migration tooling.
-- Production (yhxzwjoouiurxrmhjslg): Logan executes
--   scripts/sql/zig-17-pr4-production-physical-submission-handoff.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fail-closed preflight — no destructive dedupe
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_dup_count
  FROM (
    SELECT ar.job_id
    FROM public.automation_runs AS ar
    WHERE ar.run_type::text = 'permit_packet'
      AND ar.run_status::text IN ('queued', 'running')
    GROUP BY ar.job_id
    HAVING count(*) > 1
  ) AS dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'zig17_pr4_active_permit_packet: refusing UNIQUE (job_id) WHERE active permit_packet — % duplicate group(s) exist; review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

DO $$
DECLARE
  v_bad_status integer;
BEGIN
  -- Historical completed rows may have completed_by NULL (ZIG-8 CHECK).
  -- Do not reject or backfill them.
  SELECT count(*)::integer
  INTO v_bad_status
  FROM public.job_actions AS ja
  WHERE ja.status IS DISTINCT FROM 'pending'
    AND ja.status IS DISTINCT FROM 'completed';

  IF v_bad_status > 0 THEN
    RAISE EXCEPTION
      'zig17_pr4_job_actions: refusing status CHECK — % row(s) have status other than pending/completed; review required (no destructive rewrite)',
      v_bad_status;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) cancelled_at + status/timestamp CHECKs
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_actions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

COMMENT ON COLUMN public.job_actions.cancelled_at IS
  'Set only when status = cancelled. Never used for physical-submission completion (ZIG-11 uses completed_at/completed_by).';

ALTER TABLE public.job_actions
  DROP CONSTRAINT IF EXISTS job_actions_status_allowed;

ALTER TABLE public.job_actions
  DROP CONSTRAINT IF EXISTS job_actions_completed_fields_consistent;

ALTER TABLE public.job_actions
  ADD CONSTRAINT job_actions_status_allowed
  CHECK (status IN ('pending', 'completed', 'cancelled'));

ALTER TABLE public.job_actions
  ADD CONSTRAINT job_actions_status_timestamps_consistent
  CHECK (
    (
      status = 'pending'
      AND completed_at IS NULL
      AND completed_by IS NULL
      AND cancelled_at IS NULL
    )
    OR (
      status = 'completed'
      AND completed_at IS NOT NULL
      AND cancelled_at IS NULL
    )
    OR (
      status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND completed_at IS NULL
      AND completed_by IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Unique indexes — verify existing pending index; verify-or-create active run
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.zig17_pr4_ensure_unique_index(
  p_index_name text,
  p_expected_schema text,
  p_expected_table text,
  p_expected_cols text[],
  p_pred_kind text,
  p_create_sql text,
  p_must_exist boolean
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
    IF p_must_exist THEN
      RAISE EXCEPTION
        'zig17_pr4_index_missing: public.% is required and was not found; review required (no automatic recreate)',
        p_index_name;
    END IF;
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
          p_pred_kind = 'physical_submission_pending'
          AND (
            v_pred_norm NOT LIKE '%action_type%'
            OR v_pred_norm NOT LIKE '%status%'
            OR v_labels IS DISTINCT FROM ARRAY['pending', 'physical_submission']::text[]
          )
        )
     OR (
          p_pred_kind = 'active_permit_packet'
          AND (
            v_pred_norm NOT LIKE '%run_type%'
            OR v_pred_norm NOT LIKE '%run_status%'
            OR v_labels IS DISTINCT FROM ARRAY['permit_packet', 'queued', 'running']::text[]
          )
        )
  THEN
    RAISE EXCEPTION
      'zig17_pr4_index_mismatch: public.% exists but does not match required unique index (table=%.% unique=% valid=% cols=% nkeys=% pred=% labels=%); review required (no automatic drop/recreate)',
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

-- Preserve the ZIG-8 one-pending physical_submission index exactly.
SELECT pg_temp.zig17_pr4_ensure_unique_index(
  'job_actions_one_pending_physical_submission_idx',
  'public',
  'job_actions',
  ARRAY['job_id']::text[],
  'physical_submission_pending',
  $c$
    SELECT 1;
  $c$,
  true
);

SELECT pg_temp.zig17_pr4_ensure_unique_index(
  'automation_runs_one_active_permit_packet_uidx',
  'public',
  'automation_runs',
  ARRAY['job_id']::text[],
  'active_permit_packet',
  $c$
    CREATE UNIQUE INDEX automation_runs_one_active_permit_packet_uidx
      ON public.automation_runs (job_id)
      WHERE run_type::text = 'permit_packet'
        AND run_status::text IN ('queued', 'running');
  $c$,
  false
);

-- ---------------------------------------------------------------------------
-- 4) Authoritative ready RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_permit_packet(
  p_job_id uuid,
  p_fingerprint jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_status text;
  v_specs jsonb;
  v_packet jsonb;
  v_prior_fp jsonb;
  v_history jsonb;
  v_stored_input text;
  v_stored_content text;
  v_in_input text;
  v_in_content text;
  v_action_id uuid;
  v_created boolean := false;
  v_history_len integer;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'complete_permit_packet: job_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT j.company_id, j.job_status::text, COALESCE(j.job_specs, '{}'::jsonb)
  INTO v_company_id, v_status, v_specs
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_permit_packet: job not found: %', p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'complete_permit_packet: job.company_id is required for job %', p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.job_documents AS jd
    WHERE jd.job_id = p_job_id
      AND jd.document_type::text = 'submission_packet'
  ) THEN
    RAISE EXCEPTION
      'complete_permit_packet: canonical submission_packet is required for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF (v_specs #> '{packet,complete}') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION
      'complete_permit_packet: job_specs.packet.complete must be true for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_fingerprint) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'complete_permit_packet: fingerprint object is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_fingerprint -> 'version') IS DISTINCT FROM 'number'
     OR (p_fingerprint ->> 'version') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'complete_permit_packet: fingerprint.version must be 1'
      USING ERRCODE = 'P0001';
  END IF;

  v_in_input := p_fingerprint ->> 'input_fingerprint';
  v_in_content := p_fingerprint ->> 'content_fingerprint';

  IF v_in_input IS NULL OR v_in_input !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'complete_permit_packet: fingerprint.input_fingerprint must be lowercase 64-char hex'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_in_content IS NULL OR v_in_content !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'complete_permit_packet: fingerprint.content_fingerprint must be lowercase 64-char hex'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_fingerprint ->> 'computed_at', '') = '' THEN
    RAISE EXCEPTION 'complete_permit_packet: fingerprint.computed_at is required'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    IF NOT isfinite((p_fingerprint ->> 'computed_at')::timestamptz) THEN
      RAISE EXCEPTION 'complete_permit_packet: fingerprint.computed_at is invalid'
        USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'complete_permit_packet: fingerprint.computed_at is invalid'
        USING ERRCODE = 'P0001';
  END;

  IF jsonb_typeof(p_fingerprint -> 'artifacts') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'complete_permit_packet: fingerprint.artifacts must be a JSON array'
      USING ERRCODE = 'P0001';
  END IF;

  -- ZIG-8 prior-status set plus already-ready idempotency.
  -- 'ready' is reachable: contractor insert uses job_status='ready'; admin and
  -- job-detail UIs can reset to ready while a permit_packet run is queued/running;
  -- worker claim does not rewrite job_status before complete_permit_packet.
  IF v_status IS DISTINCT FROM 'ready'
     AND v_status IS DISTINCT FROM 'automation_running'
     AND v_status IS DISTINCT FROM 'needs_review'
     AND v_status IS DISTINCT FROM 'needs_correction'
     AND v_status IS DISTINCT FROM 'ready_for_physical_submission' THEN
    RAISE EXCEPTION
      'permit_packet_invalid_prior_status: job % has unexpected status; transition refused',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  v_packet := COALESCE(v_specs -> 'packet', '{}'::jsonb);
  v_stored_input := v_packet #>> '{fingerprint,input_fingerprint}';
  v_stored_content := v_packet #>> '{fingerprint,content_fingerprint}';

  IF v_status = 'ready_for_physical_submission'
     AND (
       v_stored_input IS DISTINCT FROM v_in_input
       OR v_stored_content IS DISTINCT FROM v_in_content
     ) THEN
    SELECT ja.id
    INTO v_action_id
    FROM public.job_actions AS ja
    WHERE ja.job_id = p_job_id
      AND ja.action_type = 'physical_submission'
      AND ja.status = 'pending'
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'job_id', p_job_id,
      'company_id', v_company_id,
      'job_status', v_status,
      'action_id', v_action_id,
      'action_created', false,
      'noop_reason', 'ready_fingerprint_mismatch'
    );
  END IF;

  IF v_status = 'ready_for_physical_submission'
     AND v_stored_input = v_in_input
     AND v_stored_content = v_in_content THEN
    INSERT INTO public.job_actions (job_id, company_id, action_type, status)
    VALUES (p_job_id, v_company_id, 'physical_submission', 'pending')
    ON CONFLICT (job_id) WHERE (action_type = 'physical_submission' AND status = 'pending')
    DO NOTHING
    RETURNING id INTO v_action_id;

    IF v_action_id IS NOT NULL THEN
      v_created := true;
    ELSE
      SELECT ja.id
      INTO v_action_id
      FROM public.job_actions AS ja
      WHERE ja.job_id = p_job_id
        AND ja.action_type = 'physical_submission'
        AND ja.status = 'pending'
      LIMIT 1;
      v_created := false;
    END IF;

    IF v_action_id IS NULL THEN
      RAISE EXCEPTION
        'complete_permit_packet: pending physical_submission action missing after upsert for job %',
        p_job_id
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.job_actions AS ja
      WHERE ja.id = v_action_id
        AND (
          ja.completed_by IS NOT NULL
          OR ja.cancelled_at IS NOT NULL
          OR ja.status <> 'pending'
        )
    ) THEN
      RAISE EXCEPTION
        'complete_permit_packet: refusing to return a non-pending action for job %',
        p_job_id
        USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'job_id', p_job_id,
      'company_id', v_company_id,
      'job_status', 'ready_for_physical_submission',
      'action_id', v_action_id,
      'action_created', v_created
    );
  END IF;

  IF jsonb_typeof(v_packet) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'complete_permit_packet: job_specs.packet must be a JSON object for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  v_prior_fp := v_packet -> 'fingerprint';
  v_history := COALESCE(v_packet -> 'fingerprint_history', '[]'::jsonb);
  IF jsonb_typeof(v_history) IS DISTINCT FROM 'array' THEN
    v_history := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(v_prior_fp) = 'object' THEN
    v_history := v_history || jsonb_build_array(v_prior_fp);
    v_history_len := jsonb_array_length(v_history);
    IF v_history_len > 5 THEN
      SELECT coalesce(jsonb_agg(sub.elem ORDER BY sub.ord), '[]'::jsonb)
      INTO v_history
      FROM (
        SELECT t.elem, t.ord
        FROM jsonb_array_elements(v_history) WITH ORDINALITY AS t(elem, ord)
        WHERE t.ord > (v_history_len - 5)
      ) AS sub;
    END IF;
  END IF;

  v_packet := (v_packet - 'stale')
    || jsonb_build_object(
      'fingerprint', p_fingerprint,
      'fingerprint_history', v_history
    );

  UPDATE public.jobs AS j
  SET
    job_status = 'ready_for_physical_submission',
    job_specs = v_specs || jsonb_build_object('packet', v_packet),
    updated_at = now()
  WHERE j.id = p_job_id;

  INSERT INTO public.job_actions (job_id, company_id, action_type, status)
  VALUES (p_job_id, v_company_id, 'physical_submission', 'pending')
  ON CONFLICT (job_id) WHERE (action_type = 'physical_submission' AND status = 'pending')
  DO NOTHING
  RETURNING id INTO v_action_id;

  IF v_action_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT ja.id
    INTO v_action_id
    FROM public.job_actions AS ja
    WHERE ja.job_id = p_job_id
      AND ja.action_type = 'physical_submission'
      AND ja.status = 'pending'
    LIMIT 1;
    v_created := false;
  END IF;

  IF v_action_id IS NULL THEN
    RAISE EXCEPTION
      'complete_permit_packet: pending physical_submission action missing after upsert for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_actions AS ja
    WHERE ja.id = v_action_id
      AND (
        ja.completed_by IS NOT NULL
        OR ja.cancelled_at IS NOT NULL
        OR ja.status <> 'pending'
      )
  ) THEN
    RAISE EXCEPTION
      'complete_permit_packet: refusing to return a non-pending action for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'company_id', v_company_id,
    'job_status', 'ready_for_physical_submission',
    'action_id', v_action_id,
    'action_created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_permit_packet(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_permit_packet(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.complete_permit_packet(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_permit_packet(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.complete_permit_packet(uuid, jsonb) IS
  'ZIG-17 PR 4 atomic permit_packet success: persist application-computed fingerprint, set ready_for_physical_submission, ensure one pending physical_submission. Never downloads Storage. Never writes completed_by.';

-- ---------------------------------------------------------------------------
-- 5) Compatibility skeleton — no duplicated ready-transition logic
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_permit_packet_skeleton(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'complete_permit_packet_skeleton is retired; use complete_permit_packet(p_job_id, p_fingerprint)'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_permit_packet_skeleton(uuid) TO service_role;

COMMENT ON FUNCTION public.complete_permit_packet_skeleton(uuid) IS
  'Retired ZIG-8 compatibility wrapper. Call complete_permit_packet(p_job_id, p_fingerprint).';

-- ---------------------------------------------------------------------------
-- 6) Stale invalidation RPC — CAS on stored input_fingerprint
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.invalidate_permit_packet_readiness(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.invalidate_permit_packet_readiness(
  p_job_id uuid,
  p_expected_stored_input_fingerprint text,
  p_expect_missing_stored_fingerprint boolean,
  p_observed_input_fingerprint text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_status text;
  v_specs jsonb;
  v_packet jsonb;
  v_stored_input text;
  v_stored_valid boolean;
  v_expected text;
  v_expected_valid boolean;
  v_cancelled_ids jsonb := '[]'::jsonb;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'invalidate_permit_packet_readiness: job_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_expect_missing_stored_fingerprint IS NULL THEN
    RAISE EXCEPTION
      'invalidate_permit_packet_readiness: p_expect_missing_stored_fingerprint is required'
      USING ERRCODE = 'P0001';
  END IF;

  v_expected := btrim(COALESCE(p_expected_stored_input_fingerprint, ''));
  v_expected_valid := v_expected ~ '^[0-9a-f]{64}$';

  IF p_expect_missing_stored_fingerprint IS TRUE THEN
    IF v_expected <> '' THEN
      RAISE EXCEPTION
        'invalidate_permit_packet_readiness: p_expect_missing_stored_fingerprint cannot be combined with a non-empty expected fingerprint'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NOT v_expected_valid THEN
    RAISE EXCEPTION
      'invalidate_permit_packet_readiness: p_expected_stored_input_fingerprint must be lowercase 64-char hex when p_expect_missing_stored_fingerprint is false'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT j.company_id, j.job_status::text, COALESCE(j.job_specs, '{}'::jsonb)
  INTO v_company_id, v_status, v_specs
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalidate_permit_packet_readiness: job not found: %', p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION
      'invalidate_permit_packet_readiness: job.company_id is required for job %',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status IS DISTINCT FROM 'ready_for_physical_submission' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'job_id', p_job_id,
      'company_id', v_company_id,
      'job_status', v_status,
      'invalidated', false,
      'cancelled_action_ids', '[]'::jsonb,
      'noop_reason', 'not_ready'
    );
  END IF;

  v_packet := COALESCE(v_specs -> 'packet', '{}'::jsonb);
  IF jsonb_typeof(v_packet) IS DISTINCT FROM 'object' THEN
    v_packet := '{}'::jsonb;
  END IF;
  v_stored_input := btrim(COALESCE(v_packet #>> '{fingerprint,input_fingerprint}', ''));
  v_stored_valid := v_stored_input ~ '^[0-9a-f]{64}$';

  IF p_expect_missing_stored_fingerprint IS TRUE THEN
    IF v_stored_valid THEN
      RETURN jsonb_build_object(
        'ok', true,
        'job_id', p_job_id,
        'company_id', v_company_id,
        'job_status', v_status,
        'invalidated', false,
        'cancelled_action_ids', '[]'::jsonb,
        'noop_reason', 'fingerprint_cas_mismatch'
      );
    END IF;
  ELSIF (NOT v_stored_valid) OR v_stored_input IS DISTINCT FROM v_expected THEN
    RETURN jsonb_build_object(
      'ok', true,
      'job_id', p_job_id,
      'company_id', v_company_id,
      'job_status', v_status,
      'invalidated', false,
      'cancelled_action_ids', '[]'::jsonb,
      'noop_reason', 'fingerprint_cas_mismatch'
    );
  END IF;

  v_packet := v_packet || jsonb_build_object(
    'complete', false,
    'stale', jsonb_build_object(
      'invalidated_at', to_jsonb(now()),
      'reason', COALESCE(NULLIF(btrim(p_reason), ''), 'unspecified'),
      'expected_stored_input_fingerprint', to_jsonb(p_expected_stored_input_fingerprint),
      'observed_input_fingerprint', to_jsonb(p_observed_input_fingerprint)
    )
  );

  UPDATE public.jobs AS j
  SET
    job_status = 'needs_correction',
    job_specs = v_specs || jsonb_build_object('packet', v_packet),
    updated_at = now()
  WHERE j.id = p_job_id;

  WITH cancelled AS (
    UPDATE public.job_actions AS ja
    SET
      status = 'cancelled',
      cancelled_at = now()
    WHERE ja.job_id = p_job_id
      AND ja.action_type = 'physical_submission'
      AND ja.status = 'pending'
    RETURNING ja.id
  )
  SELECT coalesce(jsonb_agg(cancelled.id), '[]'::jsonb)
  INTO v_cancelled_ids
  FROM cancelled;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'company_id', v_company_id,
    'job_status', 'needs_correction',
    'invalidated', true,
    'cancelled_action_ids', v_cancelled_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_permit_packet_readiness(uuid, text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_permit_packet_readiness(uuid, text, boolean, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.invalidate_permit_packet_readiness(uuid, text, boolean, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_permit_packet_readiness(uuid, text, boolean, text, text) TO service_role;

COMMENT ON FUNCTION public.invalidate_permit_packet_readiness(uuid, text, boolean, text, text) IS
  'ZIG-17 PR 4 CAS stale invalidation: ready → needs_correction, cancel pending physical_submission, keep last-ready fingerprint. Missing-fingerprint CAS uses p_expect_missing_stored_fingerprint. Never marks actions completed.';

COMMIT;
