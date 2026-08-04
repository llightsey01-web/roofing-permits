-- Add database-layer access control for AHJ document requirement metadata.
-- Founder review required; execute manually in the Supabase SQL Editor.
--
-- ahj_document_requirements is global AHJ reference data and has no company_id.
-- Contractor read access is therefore scoped to authenticated users who belong
-- to a company, rather than to per-row company ownership.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

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
