-- Document and idempotently enforce RLS already confirmed in the live schema.
-- Policy definitions intentionally remain unchanged.

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_ahj_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_log ENABLE ROW LEVEL SECURITY;
