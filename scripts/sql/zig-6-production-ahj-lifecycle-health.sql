-- ZIG-6 PRODUCTION SQL — FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY
-- Do not run via agent. Apply only after staging validation passes.
-- Required order: this DDL+backfill → then Railway application deploy.
--
-- Project: production (yhxzwjoouiurxrmhjslg)
-- Equivalent to: supabase/migrations/20260817123709_ahj_lifecycle_health_readiness.sql

CREATE TYPE public.ahj_lifecycle_state AS ENUM (
  'planned',
  'development',
  'validation_ready',
  'dry_run',
  'pilot',
  'production'
);

CREATE TYPE public.ahj_operational_health AS ENUM (
  'healthy',
  'degraded',
  'unavailable'
);

ALTER TABLE public.ahj_portals
  ADD COLUMN lifecycle_state public.ahj_lifecycle_state NOT NULL DEFAULT 'planned',
  ADD COLUMN operational_health public.ahj_operational_health NOT NULL DEFAULT 'healthy';

UPDATE public.ahj_portals SET lifecycle_state = 'production', operational_health = 'healthy'
WHERE lower(name) = lower('Polk County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'pilot', operational_health = 'healthy'
WHERE lower(name) = lower('Lee County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Hillsborough County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Pinellas County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Pasco County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Sarasota County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Charlotte County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Manatee County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Brevard County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Osceola County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'validation_ready', operational_health = 'healthy'
WHERE lower(name) = lower('Citrus County Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'planned', operational_health = 'healthy'
WHERE lower(name) = lower('City of Bradenton Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'planned', operational_health = 'healthy'
WHERE lower(name) = lower('City of DeLand Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'planned', operational_health = 'healthy'
WHERE lower(name) = lower('City of Tampa Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'planned', operational_health = 'healthy'
WHERE lower(name) = lower('City of Weston Building Department');

UPDATE public.ahj_portals SET lifecycle_state = 'planned', operational_health = 'healthy'
WHERE lower(name) = lower('Lake County Building Department');

-- Verification (run after backfill; expect 16 rows with approved values):
-- SELECT name, lifecycle_state, operational_health, is_active, workflow_file
-- FROM public.ahj_portals
-- ORDER BY name;
