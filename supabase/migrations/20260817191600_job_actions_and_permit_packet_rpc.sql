-- ZIG-8: job_actions human-handoff primitive + atomic permit_packet skeleton RPC.
-- Staging-first. Production: Logan executes scripts/sql/zig-8-production-job-actions.sql.
-- Worker may create pending physical_submission actions via RPC only.
-- Worker must never mark actions completed (ZIG-11 owns completion).

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

CREATE OR REPLACE FUNCTION private.dartiq_current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_user.company_id
  FROM public.users AS app_user
  WHERE app_user.id = (SELECT auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.dartiq_is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.dartiq_current_company_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.dartiq_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.dartiq_current_company_id() TO authenticated;

CREATE TABLE IF NOT EXISTS public.job_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- Denormalized tenant key (server/job-derived only; never trust client input).
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  -- Session-derived identity only (ZIG-11). Worker must leave null.
  completed_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  notes text NULL,
  CONSTRAINT job_actions_action_type_allowed
    CHECK (action_type IN ('physical_submission')),
  CONSTRAINT job_actions_status_allowed
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT job_actions_completed_fields_consistent CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status = 'pending' AND completed_at IS NULL AND completed_by IS NULL)
  )
);

COMMENT ON TABLE public.job_actions IS
  'Expected human handoffs (e.g. physical_submission). Distinct from review_requests exception gates.';

COMMENT ON COLUMN public.job_actions.company_id IS
  'Denormalized from jobs.company_id at insert; never accept from client.';

COMMENT ON COLUMN public.job_actions.completed_by IS
  'Must be verified session user id (ZIG-11). Worker paths must not write this.';

-- One pending physical_submission action per job (idempotent retries).
CREATE UNIQUE INDEX IF NOT EXISTS job_actions_one_pending_physical_submission_idx
  ON public.job_actions (job_id)
  WHERE action_type = 'physical_submission' AND status = 'pending';

CREATE INDEX IF NOT EXISTS job_actions_company_id_idx
  ON public.job_actions (company_id);

CREATE INDEX IF NOT EXISTS job_actions_job_id_idx
  ON public.job_actions (job_id);

CREATE INDEX IF NOT EXISTS job_actions_company_status_idx
  ON public.job_actions (company_id, status, created_at DESC);

ALTER TABLE public.job_actions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.job_actions TO authenticated;
-- No INSERT/UPDATE/DELETE grants for authenticated: completion is ZIG-11 via
-- controlled API (service role or future narrow policies). Service role bypasses RLS.

DROP POLICY IF EXISTS job_actions_super_admin_all ON public.job_actions;
CREATE POLICY job_actions_super_admin_all
  ON public.job_actions
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT private.dartiq_is_super_admin()))
  WITH CHECK ((SELECT private.dartiq_is_super_admin()));

DROP POLICY IF EXISTS job_actions_company_select ON public.job_actions;
CREATE POLICY job_actions_company_select
  ON public.job_actions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND company_id = (SELECT private.dartiq_current_company_id())
  );

-- Atomic: set ready_for_physical_submission + ensure one pending physical_submission action.
-- company_id is always taken from jobs — never from caller args.
CREATE OR REPLACE FUNCTION public.complete_permit_packet_skeleton(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company_id uuid;
  v_action_id uuid;
  v_created boolean := false;
  v_updated integer := 0;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'complete_permit_packet_skeleton: job_id is required';
  END IF;

  SELECT j.company_id
  INTO v_company_id
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'complete_permit_packet_skeleton: job not found: %', p_job_id;
  END IF;

  UPDATE public.jobs AS j
  SET job_status = 'ready_for_physical_submission'
  WHERE j.id = p_job_id
    AND j.job_status IN (
      'ready',
      'automation_running',
      'needs_review',
      'needs_correction'
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION
      'permit_packet_invalid_prior_status: job % has unexpected status; transition refused',
      p_job_id
      USING ERRCODE = 'P0001';
  END IF;

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
  END IF;

  IF v_action_id IS NULL THEN
    RAISE EXCEPTION
      'complete_permit_packet_skeleton: pending physical_submission action missing after upsert for job %',
      p_job_id;
  END IF;

  -- Invariant: completed_by must remain null for worker-created pending actions.
  IF EXISTS (
    SELECT 1
    FROM public.job_actions AS ja
    WHERE ja.id = v_action_id
      AND (ja.completed_by IS NOT NULL OR ja.status <> 'pending')
  ) THEN
    RAISE EXCEPTION
      'complete_permit_packet_skeleton: refusing to return a completed action for job %',
      p_job_id;
  END IF;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'company_id', v_company_id,
    'action_id', v_action_id,
    'action_created', v_created,
    'job_status', 'ready_for_physical_submission'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_permit_packet_skeleton(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_permit_packet_skeleton(uuid) TO service_role;

COMMENT ON FUNCTION public.complete_permit_packet_skeleton(uuid) IS
  'ZIG-8 atomic permit_packet skeleton success: job_status + one pending physical_submission job_action. company_id from jobs only.';

COMMIT;
