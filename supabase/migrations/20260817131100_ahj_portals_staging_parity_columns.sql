-- ZIG-7: Restore additive ahj_portals schema parity in staging
-- Staging-first (trimwcwzimfgzgimfwby / dart-iq-staging).
-- Additive nullable columns only. Does not alter existing column types/nullability.
-- Does not touch lifecycle_state, operational_health, or ZIG-6 artifacts.
-- No production SQL in this issue.

ALTER TABLE public.ahj_portals
  ADD COLUMN IF NOT EXISTS submission_method text DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS avg_approval_days integer,
  ADD COLUMN IF NOT EXISTS permit_fee_info text,
  ADD COLUMN IF NOT EXISTS portal_tips text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS office_hours text;
