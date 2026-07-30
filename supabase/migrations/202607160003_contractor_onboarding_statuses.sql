-- Extend company onboarding status values for contractor wizard + admin review
-- Run in Supabase SQL editor if needed (text column already exists)

COMMENT ON COLUMN companies.onboarding_status IS
  'pending | in_progress | pending_review | needs_changes | active | complete | suspended';
