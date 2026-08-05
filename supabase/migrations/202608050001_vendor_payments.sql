-- Vendor cost ledger: structured record of third-party payouts per job.
-- Schema + RLS only. No payment execution. Founder review required;
-- execute manually in the Supabase SQL Editor (staging first when validating).
--
-- Money convention: amount_cents INTEGER (cents). Note: jobs.valuation is stored
-- as a float/numeric via parseFloat in intake APIs — that existing inconsistency
-- is documented, not copied here.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Reuse / ensure hardened SECURITY DEFINER helpers (idempotent with prior RLS migrations).
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

CREATE TABLE IF NOT EXISTS public.vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Extensible text vendors (app validates known set; add future AHJs without enum migration).
  -- Current: polk_county, onenotary, epn, lee_county (reserved), other
  vendor text NOT NULL,
  -- Extensible payment kinds: permit_fee, notarization, recording_fee, surcharge, other
  payment_type text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'failed')),
  -- RESTRICT: keep attestation identity; do not silently null confirmed_by on user delete.
  confirmed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  vendor_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_payments_vendor_nonempty CHECK (length(trim(vendor)) > 0),
  CONSTRAINT vendor_payments_payment_type_nonempty CHECK (length(trim(payment_type)) > 0),
  CONSTRAINT vendor_payments_currency_nonempty CHECK (length(trim(currency)) > 0),
  CONSTRAINT vendor_payments_confirmed_fields_consistent CHECK (
    (status = 'confirmed' AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed')
  )
);

CREATE INDEX IF NOT EXISTS vendor_payments_job_id_idx
  ON public.vendor_payments (job_id);

CREATE INDEX IF NOT EXISTS vendor_payments_company_id_idx
  ON public.vendor_payments (company_id);

CREATE INDEX IF NOT EXISTS vendor_payments_company_created_idx
  ON public.vendor_payments (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vendor_payments_job_status_idx
  ON public.vendor_payments (job_id, status);

COMMENT ON TABLE public.vendor_payments IS
  'Per-job third-party vendor payout ledger (permit fees, notarization, recording, etc.). amount_cents is integer cents.';

COMMENT ON COLUMN public.vendor_payments.amount_cents IS
  'Integer cents. Do not store dollars as float here (unlike jobs.valuation intake).';

COMMENT ON COLUMN public.vendor_payments.metadata IS
  'Vendor-specific detail (e.g. Polk Pay Fees line items) without schema churn.';

ALTER TABLE public.vendor_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.vendor_payments TO authenticated;
-- service_role bypasses RLS for automation / API writes after auth checks.

DROP POLICY IF EXISTS vendor_payments_super_admin_all
  ON public.vendor_payments;

CREATE POLICY vendor_payments_super_admin_all
  ON public.vendor_payments
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT private.dartiq_is_super_admin()))
  WITH CHECK ((SELECT private.dartiq_is_super_admin()));

DROP POLICY IF EXISTS vendor_payments_company_select
  ON public.vendor_payments;

CREATE POLICY vendor_payments_company_select
  ON public.vendor_payments
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND company_id = (SELECT private.dartiq_current_company_id())
  );

COMMIT;
