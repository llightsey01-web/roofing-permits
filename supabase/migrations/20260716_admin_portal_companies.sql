-- Admin portal: company onboarding / subscription columns
-- Run manually in Supabase SQL editor against production

-- Onboarding + subscription fields on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dba_name text,
  ADD COLUMN IF NOT EXISTS onboarding_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS notes text;

-- Ensure is_active exists (used by current admin page)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Lead pipeline status for admin leads inbox
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes text;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS companies_onboarding_status_idx
  ON companies (onboarding_status);

CREATE INDEX IF NOT EXISTS companies_subscription_status_idx
  ON companies (subscription_status);

CREATE INDEX IF NOT EXISTS leads_status_idx
  ON leads (status);

COMMENT ON COLUMN companies.onboarding_status IS 'pending | in_progress | complete | suspended';
COMMENT ON COLUMN companies.subscription_plan IS 'starter | growth | scale | enterprise';
COMMENT ON COLUMN companies.subscription_status IS 'trial | active | past_due | cancelled | suspended';
COMMENT ON COLUMN leads.status IS 'new | contacted | converted | rejected';
