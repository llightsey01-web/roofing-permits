-- Feature 3 — NOC workflow options
-- Run manually in Supabase SQL editor

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS noc_option text DEFAULT 'auto_generate';

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS onboarding_step int DEFAULT 0;

COMMENT ON COLUMN jobs.noc_option IS
  'auto_generate | upload_signed | upload_notarized | upload_recorded | manual_download';
