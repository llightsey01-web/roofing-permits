-- MANUAL EXECUTION ONLY — run in Supabase SQL Editor. Never wire into automated runners or CI.
--
-- Seed: Accela AHJ backlog (14 Florida jurisdictions).
-- Date: 2026-08-11
--
-- Excludes Polk County and Lee County (already live) — no insert/update/upsert for those.
-- All new rows: is_active = false, workflow_type = 'portal', workflow_file = NULL,
-- credential_key = NULL (expected future keys noted in per-row SQL comments).
--
-- Naming convention (live Polk/Lee ground truth):
--   name           = "<jurisdiction> Building Department"
--   county_or_city = "<X> County" for counties; short municipality (no "County") for cities
--
-- Idempotency: live schema has UNIQUE only on id (ahj_portals_pkey). There is no unique
-- constraint on name / county_or_city / credential_key, so ON CONFLICT cannot be used.
-- Each INSERT uses WHERE NOT EXISTS on name (case-insensitive) instead.
--
-- Metadata mapping:
--   agency_code / platform / hosting / verification / parent_county / backlog → notes (text)
--   portal_url → portal_url (NULL when TBD)
--
-- workflow_type enum (live): email | hybrid | pdf_packet | portal

BEGIN;

-- Hillsborough County Building Department [expected_credential_key=HILLSBOROUGH_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Hillsborough County Building Department',
  'Hillsborough County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/hcfl',
  'platform=accela; hosting=accela-hosted; agency_code=HCFL; verification=verified; backlog=2026-08-11. Branded HillsGovHub. City of Tampa is a SEPARATE tenant.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Hillsborough County Building Department')
);

-- Pinellas County Building Department [expected_credential_key=PINELLAS_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Pinellas County Building Department',
  'Pinellas County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/pinellas',
  'platform=accela; hosting=accela-hosted; agency_code=PINELLAS; verification=verified; backlog=2026-08-11. Also issues permits for Belleair Beach, Belleair Shores, Indian Rocks Beach, Kenneth City, Safety Harbor, Oldsmar.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Pinellas County Building Department')
);

-- Pasco County Building Department [expected_credential_key=PASCO_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Pasco County Building Department',
  'Pasco County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/PASCO',
  'platform=accela; hosting=accela-hosted; agency_code=PASCO; verification=verified; backlog=2026-08-11.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Pasco County Building Department')
);

-- Sarasota County Building Department [expected_credential_key=SARASOTA_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Sarasota County Building Department',
  'Sarasota County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/SARASOTACO',
  'platform=accela; hosting=accela-hosted; agency_code=SARASOTACO; verification=verified; backlog=2026-08-11. Payment processor changed Nov 2025; surcharges on some transactions.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Sarasota County Building Department')
);

-- Charlotte County Building Department [expected_credential_key=CHARLOTTE_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Charlotte County Building Department',
  'Charlotte County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/BOCC',
  'platform=accela; hosting=accela-hosted; agency_code=BOCC; verification=verified; backlog=2026-08-11. Contractor license must be attached to portal account before applying.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Charlotte County Building Department')
);

-- Lake County Building Department [expected_credential_key=LAKE_COUNTY]
-- CORRECTION 2026-08-13: aca-prod.accela.com/LAKECO is Lake County CALIFORNIA Accela
-- (legacy UI; OpenGov migration notice). Florida Lake County Building Services uses OPRS:
-- https://mcdplus.lakecountyfl.gov/oprs_PT/ (not Accela). Do not treat as Accela peer.
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Lake County Building Department',
  'Lake County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://mcdplus.lakecountyfl.gov/oprs_PT/',
  'platform=oprs; hosting=county-hosted; agency_code=N/A; verification=corrected-2026-08-13; backlog=2026-08-11. Seed originally pointed at CA Accela LAKECO — wrong jurisdiction.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Lake County Building Department')
);

-- Brevard County Building Department [expected_credential_key=BREVARD_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Brevard County Building Department',
  'Brevard County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/BREVARD',
  'platform=accela; hosting=accela-hosted; agency_code=BREVARD; verification=verified; backlog=2026-08-11. Branded BASS. Approved contractor license required on account before applying.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Brevard County Building Department')
);

-- Manatee County Building Department [expected_credential_key=MANATEE_COUNTY]
-- 2026-08-13: agency_code=MANATEE confirmed. County CMS mymanatee.org Accela Online Services
-- 301-redirects to https://aca-prod.accela.com/MANATEE/Default.aspx (not Accela-hosted on custom domain).
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Manatee County Building Department',
  'Manatee County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/MANATEE',
  'platform=accela; hosting=accela-hosted; agency_code=MANATEE; verification=confirmed-2026-08-11/13; backlog=2026-08-11. County CMS entry https://www.mymanatee.org/.../accela-online-services redirects to aca-prod MANATEE.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Manatee County Building Department')
);

-- Citrus County Building Department [expected_credential_key=CITRUS_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Citrus County Building Department',
  'Citrus County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca-prod.accela.com/CITRUS',
  'platform=accela; hosting=accela-hosted; agency_code=CITRUS; verification=verified; backlog=2026-08-11. Insurance amendments and license records maintained in Accela.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Citrus County Building Department')
);

-- Osceola County Building Department (self-hosted ACA — do not use aca-prod.accela.com/OSCEOLA for filings) [expected_credential_key=OSCEOLA_COUNTY]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'Osceola County Building Department',
  'Osceola County',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://permits.osceola.org/CitizenAccess',
  'platform=accela; hosting=self-hosted; agency_code=OSCEOLA; verification=verified; backlog=2026-08-11. SELF-HOSTED ACA. aca-prod.accela.com/OSCEOLA is their TEST environment — never target it for filings.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('Osceola County Building Department')
);

-- City of Tampa Building Department (separate Accela tenant from Hillsborough County)
-- county_or_city is short municipality (no "County") so city_match can apply; see resolver evidence in commit notes.
-- [expected_credential_key=CITY_OF_TAMPA]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'City of Tampa Building Department',
  'Tampa',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  'https://aca.tampagov.net',
  'platform=accela; hosting=custom-domain; agency_code=TAMPA; verification=verified; parent_county=Hillsborough; backlog=2026-08-11. Separate tenant from Hillsborough County. Digital Plan Room (ePermitHub) integrated into ACA.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('City of Tampa Building Department')
);

-- City of DeLand Building Department (reported; URL TBD) [expected_credential_key=CITY_OF_DELAND]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'City of DeLand Building Department',
  'DeLand',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  NULL,
  'platform=accela; hosting=TBD; agency_code=TBD; verification=reported; parent_county=Volusia; backlog=2026-08-11. Accela per prior study; capture portal URL before activation.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('City of DeLand Building Department')
);

-- City of Weston Building Department (reported; URL TBD) [expected_credential_key=CITY_OF_WESTON]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'City of Weston Building Department',
  'Weston',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  NULL,
  'platform=accela; hosting=TBD; agency_code=TBD; verification=reported; parent_county=Broward; backlog=2026-08-11. Accela cloud migration per vendor press release; capture portal URL before activation.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('City of Weston Building Department')
);

-- City of Bradenton Building Department (reported; URL TBD) [expected_credential_key=CITY_OF_BRADENTON]
INSERT INTO public.ahj_portals (
  name, county_or_city, state, is_active, workflow_type, workflow_file,
  credential_key, portal_url, notes
)
SELECT
  'City of Bradenton Building Department',
  'Bradenton',
  'FL',
  false,
  'portal'::workflow_type,
  NULL,
  NULL,
  NULL,
  'platform=accela; hosting=TBD; agency_code=TBD; verification=reported; parent_county=Manatee; backlog=2026-08-11. New Accela customer per vendor press release; capture portal URL before activation.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ahj_portals p
  WHERE lower(p.name) = lower('City of Bradenton Building Department')
);

COMMIT;

-- Optional verification (run separately after apply):
-- select name, county_or_city, is_active,
--        portal_url is not null as has_url,
--        last_verified_at is not null as verified
-- from public.ahj_portals
-- where notes like '%backlog=2026-08-11%'
-- order by name;
