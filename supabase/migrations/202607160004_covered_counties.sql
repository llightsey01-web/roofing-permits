-- Covered counties selected during onboarding (informational; credentials added later in Settings)

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS covered_counties text[] DEFAULT '{}';

COMMENT ON COLUMN companies.covered_counties IS
  'County keys selected during onboarding: polk | lee | manatee | sarasota';
