-- Stage 2 billing: monthly invoices + companies.subscription_plan placeholder.
-- Schema + RLS only. No Stripe API calls. Founder review required;
-- execute manually in the Supabase SQL Editor.
--
-- companies.subscription_plan already exists in live schema (admin UI uses
-- values like 'starter'). This migration sets DEFAULT 'unpriced' for new rows
-- and documents that no dollar amounts are attached yet. Existing plan values
-- are left unchanged.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Ensure helpers exist (idempotent with vendor_payments migration).
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

-- Subscription pricing placeholder on companies (column already present in production).
ALTER TABLE public.companies
  ALTER COLUMN subscription_plan SET DEFAULT 'unpriced';

COMMENT ON COLUMN public.companies.subscription_plan IS
  'Placeholder plan key only (e.g. unpriced, starter). No dollar amount or tier pricing logic is attached yet; set when pricing model is decided.';

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_period_start timestamptz NOT NULL,
  billing_period_end timestamptz NOT NULL,
  permit_fees_total_cents integer NOT NULL DEFAULT 0 CHECK (permit_fees_total_cents >= 0),
  -- Placeholder pending pricing decision; invoice generator stores 0 until then.
  subscription_amount_cents integer NOT NULL DEFAULT 0 CHECK (subscription_amount_cents >= 0),
  total_cents integer GENERATED ALWAYS AS (permit_fees_total_cents + subscription_amount_cents) STORED,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  paid_at timestamptz,
  -- Populated once real Stripe invoice-send / webhook integration exists.
  stripe_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_period_order CHECK (billing_period_end > billing_period_start),
  CONSTRAINT invoices_period_unique UNIQUE (company_id, billing_period_start, billing_period_end)
);

CREATE INDEX IF NOT EXISTS invoices_company_id_idx
  ON public.invoices (company_id);

CREATE INDEX IF NOT EXISTS invoices_company_status_idx
  ON public.invoices (company_id, status);

CREATE INDEX IF NOT EXISTS invoices_due_date_idx
  ON public.invoices (due_date);

CREATE INDEX IF NOT EXISTS invoices_status_due_date_idx
  ON public.invoices (status, due_date);

COMMENT ON TABLE public.invoices IS
  'Monthly company invoices. permit_fees_total_cents = confirmed vendor_payments on jobs with job_status=permit_issued and permit_issued_at in the billing period — not all confirmed vendor spend. subscription_amount_cents is a pricing placeholder (0 until priced).';

COMMENT ON COLUMN public.invoices.permit_fees_total_cents IS
  'Sum of confirmed vendor_payments for jobs issued (permit_issued / permit_issued_at) in this period. Confirmed payout alone is not billable.';

COMMENT ON COLUMN public.invoices.subscription_amount_cents IS
  'Placeholder for future subscription pricing. Default 0; do not invent tier amounts here.';

COMMENT ON COLUMN public.invoices.stripe_invoice_id IS
  'Nullable until Stripe invoice-send/webhook integration is wired.';

COMMENT ON COLUMN public.invoices.total_cents IS
  'Generated: permit_fees_total_cents + subscription_amount_cents.';

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.invoices TO authenticated;
-- service_role bypasses RLS for generator / admin API writes after auth checks.

DROP POLICY IF EXISTS invoices_super_admin_all
  ON public.invoices;

CREATE POLICY invoices_super_admin_all
  ON public.invoices
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT private.dartiq_is_super_admin()))
  WITH CHECK ((SELECT private.dartiq_is_super_admin()));

DROP POLICY IF EXISTS invoices_company_select
  ON public.invoices;

CREATE POLICY invoices_company_select
  ON public.invoices
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND company_id = (SELECT private.dartiq_current_company_id())
  );

COMMIT;
