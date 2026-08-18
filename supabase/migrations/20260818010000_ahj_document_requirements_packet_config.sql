-- ZIG-10: staging foundation for ahj_document_requirements + packet-config columns.
-- Forward-only. Does NOT replay 20260730 / 202608020001 verbatim.
-- Does NOT pretend those historical migrations ran.
--
-- Staging (trimwcwzimfgzgimfwby): table was missing — CREATE IF NOT EXISTS + RLS.
-- Production (yhxzwjoouiurxrmhjslg): baseline table/RLS already exist — this migration
--   converges columns/index/CHECK idempotently. Prefer scripts/sql/zig-10-production-packet-config.sql
--   for Logan's manual production apply (with duplicate precheck).

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------
-- Helpers (idempotent; match tracked RLS migration semantics)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.dartiq_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = (SELECT auth.uid())
      AND app_user.role::text = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.dartiq_is_company_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = (SELECT auth.uid())
      AND app_user.role::text = 'company_admin'
      AND app_user.company_id IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION private.dartiq_is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.dartiq_is_company_user() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.dartiq_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.dartiq_is_company_user() TO authenticated;

-- ---------------------------------------------------------------------------
-- Baseline table (production-compatible columns from verified schema)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ahj_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ahj_id uuid REFERENCES public.ahj_portals(id),
  document_role text NOT NULL,
  display_name text NOT NULL,
  required boolean DEFAULT true,
  template_storage_path text,
  requires_permit_number boolean DEFAULT false,
  field_map jsonb,
  sort_order integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ahj_document_requirements_ahj
  ON public.ahj_document_requirements (ahj_id, sort_order);

COMMENT ON TABLE public.ahj_document_requirements IS
  'Per-AHJ required document roles for the job document folder / physical packet. document_role maps to job_documents.document_type.';

-- ---------------------------------------------------------------------------
-- ZIG-10 columns (additive; defaults keep existing Polk-style rows compatible)
-- ---------------------------------------------------------------------------

ALTER TABLE public.ahj_document_requirements
  ADD COLUMN IF NOT EXISTS include_in_submission_packet boolean NOT NULL DEFAULT true;

ALTER TABLE public.ahj_document_requirements
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'contractor_uploaded';

-- CHECK for source_type (idempotent by constraint name)
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

-- ---------------------------------------------------------------------------
-- Unique (ahj_id, document_role) — fail if duplicates already exist
-- ---------------------------------------------------------------------------

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
      'zig10_packet_config: refusing UNIQUE (ahj_id, document_role) — % duplicate group(s) exist; review required (no destructive dedupe)',
      v_dup_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ahj_document_requirements_ahj_id_document_role_uidx
  ON public.ahj_document_requirements (ahj_id, document_role);

-- ---------------------------------------------------------------------------
-- RLS (same policy bodies as 202608020001; idempotent DROP/CREATE)
-- ---------------------------------------------------------------------------

ALTER TABLE public.ahj_document_requirements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.ahj_document_requirements
  TO authenticated;

DROP POLICY IF EXISTS ahj_document_requirements_super_admin_all
  ON public.ahj_document_requirements;

CREATE POLICY ahj_document_requirements_super_admin_all
  ON public.ahj_document_requirements
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT private.dartiq_is_super_admin()))
  WITH CHECK ((SELECT private.dartiq_is_super_admin()));

DROP POLICY IF EXISTS ahj_document_requirements_company_select
  ON public.ahj_document_requirements;

CREATE POLICY ahj_document_requirements_company_select
  ON public.ahj_document_requirements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT private.dartiq_is_company_user()));

COMMIT;
