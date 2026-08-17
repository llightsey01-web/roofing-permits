-- STAGING ONLY — NEVER RUN AGAINST PRODUCTION
-- MANUAL EXECUTION ONLY — run in the dart-iq-staging Supabase SQL Editor
--   project ref: trimwcwzimfgzgimfwby (dart-iq-staging)
-- Never wire into automated runners, CI, supabase db push, or production
--   (yhxzwjoouiurxrmhjslg / roofing-permits).
--
-- Seed: ZIG-6 Polk + Lee ahj_portals rows for staging validation.
-- Date: 2026-08-17
--
-- Prerequisite: ZIG-6 migration applied on staging
--   (supabase/migrations/20260817123709_ahj_lifecycle_health_readiness.sql)
--   so lifecycle_state / operational_health columns exist.
--
-- Why this seed exists:
--   Staging currently has the 14 Accela backlog AHJs but is missing Polk and Lee.
--   Production already has Polk/Lee; this file must never insert into production.
--
-- Deterministic staging-only UUIDs (UUIDv5; NOT production IDs):
--   Polk staging id: 20d47afa-07f2-5165-84e2-0fb08a1806ee
--   Lee  staging id: b307a9df-a032-56b0-9eee-aee013fcf596
-- Production IDs deliberately excluded:
--   Polk prod: 6d54bac8-9306-4fb4-b042-fbe086c007f2
--   Lee  prod: 1752d716-71de-41f9-ae58-4f9ae37cc349
--
-- Naming convention (matches supabase/seeds/2026-08-11_accela_ahj_backlog.sql):
--   name           = "<jurisdiction> Building Department"
--   county_or_city = "<X> County" for counties
--
-- Idempotency: live schema has UNIQUE only on id (ahj_portals_pkey). There is no unique
-- constraint on name / county_or_city / credential_key, so ON CONFLICT cannot be used.
-- Each INSERT uses WHERE NOT EXISTS on (id OR lower(name)).
--
-- credential_key = NULL (safer than POLK_COUNTY / LEE_COUNTY placeholders).
--   Provider inference still keys off name for Polk/Lee; do not seed credential rows.
-- portal_url = non-routable *.invalid hosts (do not copy live Accela URLs).
--
-- SQL cannot reliably detect "staging" vs "production" from catalog alone.
-- Practical guard below (outside the INSERT transaction) refuses execution when
-- known production Polk/Lee UUIDs are already present (production fingerprint).
-- Filename + header remain mandatory. Not a true environment switch.

-- Refuse if this looks like production (known prod Polk/Lee primary keys present).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ahj_portals
    WHERE id IN (
      '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid,
      '1752d716-71de-41f9-ae58-4f9ae37cc349'::uuid
    )
  ) THEN
    RAISE EXCEPTION
      'STAGING ONLY seed refused: production Polk/Lee ahj_portals id(s) present. Never run against production.';
  END IF;
END $$;

BEGIN;

-- Polk County Building Department [staging-only; expected_credential_key documented as NULL]
INSERT INTO public.ahj_portals (
  id,
  name,
  county_or_city,
  state,
  is_active,
  workflow_type,
  workflow_file,
  submission_method,
  credential_key,
  portal_url,
  lifecycle_state,
  operational_health,
  notes
)
SELECT
  '20d47afa-07f2-5165-84e2-0fb08a1806ee'::uuid,
  'Polk County Building Department',
  'Polk County',
  'FL',
  true,
  'portal'::workflow_type,
  'polk-county.runner.js',
  'portal',
  NULL,
  'https://polk.staging.ahj.invalid/portal',
  'production'::ahj_lifecycle_state,
  'healthy'::ahj_operational_health,
  'staging_only=2026-08-17; zig=6; seed=polk_lee_ahj_portals. Non-routable portal_url. credential_key NULL — do not seed credentials.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE p.id = '20d47afa-07f2-5165-84e2-0fb08a1806ee'::uuid
     OR lower(p.name) = lower('Polk County Building Department')
);

-- Lee County Building Department [staging-only; expected_credential_key documented as NULL]
INSERT INTO public.ahj_portals (
  id,
  name,
  county_or_city,
  state,
  is_active,
  workflow_type,
  workflow_file,
  submission_method,
  credential_key,
  portal_url,
  lifecycle_state,
  operational_health,
  notes
)
SELECT
  'b307a9df-a032-56b0-9eee-aee013fcf596'::uuid,
  'Lee County Building Department',
  'Lee County',
  'FL',
  true,
  'portal'::workflow_type,
  'lee-county.runner.js',
  'portal',
  NULL,
  'https://lee.staging.ahj.invalid/portal',
  'pilot'::ahj_lifecycle_state,
  'healthy'::ahj_operational_health,
  'staging_only=2026-08-17; zig=6; seed=polk_lee_ahj_portals. Non-routable portal_url. credential_key NULL — do not seed credentials.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE p.id = 'b307a9df-a032-56b0-9eee-aee013fcf596'::uuid
     OR lower(p.name) = lower('Lee County Building Department')
);

COMMIT;

-- Optional verification (run separately after apply on staging only):
-- select id, name, county_or_city, is_active, workflow_type, workflow_file,
--        submission_method, credential_key, portal_url,
--        lifecycle_state::text, operational_health::text
-- from public.ahj_portals
-- where lower(name) in (
--   lower('Polk County Building Department'),
--   lower('Lee County Building Department')
-- )
-- order by name;
