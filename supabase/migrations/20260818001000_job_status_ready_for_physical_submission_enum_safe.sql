-- ZIG-8 follow-up: reconcile jobs.job_status enum vs text drift.
-- Staging: jobs.job_status is text → this migration is a no-op.
-- Production: jobs.job_status is enum public.job_status → add
--   ready_for_physical_submission
-- if missing.
--
-- Does NOT change column type. Does NOT convert staging text → enum.
-- Safe/idempotent. Does not rewrite 20260817191500 / 20260817191600.

DO $$
DECLARE
  v_data_type text;
  v_udt_name text;
  v_is_enum_type boolean := false;
BEGIN
  SELECT c.data_type, c.udt_name
  INTO v_data_type, v_udt_name
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'jobs'
    AND c.column_name = 'job_status';

  -- Text-backed column (staging): leave unchanged.
  IF v_data_type IS DISTINCT FROM 'USER-DEFINED' OR v_udt_name IS DISTINCT FROM 'job_status' THEN
    RAISE NOTICE
      'zig8_job_status_enum_drift: jobs.job_status is %/% — skipping ALTER TYPE',
      coalesce(v_data_type, '<missing>'),
      coalesce(v_udt_name, '<missing>');
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'job_status'
      AND t.typtype = 'e'
  )
  INTO v_is_enum_type;

  IF NOT v_is_enum_type THEN
    RAISE NOTICE
      'zig8_job_status_enum_drift: public.job_status is not an enum — skipping ALTER TYPE';
    RETURN;
  END IF;

  -- Enum-backed (production): add value idempotently.
  -- This statement only adds the label; it does not assign it to any row.
  -- (Postgres: a newly added enum value cannot be *used* until this
  -- transaction commits — acceptable here because we do not use it in this file.)
  EXECUTE
    'ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS ''ready_for_physical_submission''';

  RAISE NOTICE
    'zig8_job_status_enum_drift: ensured enum label ready_for_physical_submission';
END
$$;
