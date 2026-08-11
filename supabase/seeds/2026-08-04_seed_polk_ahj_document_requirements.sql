-- MANUAL-RUN ONLY — never execute via migration tooling or supabase db push
-- Purpose: seed Polk ahj_document_requirements
-- Authored ~2026-08-04. Applied-to-prod status: UNVERIFIED as of 2026-08-11 — pending founder check
-- Policy: all SQL is run manually by the founder in the Supabase SQL Editor

-- Seed Polk County document-folder requirements (data only; no schema changes).
-- Founder review required; execute manually in the Supabase SQL Editor.
--
-- ahj_id verified from repository credential/diagnostic constants
-- (scripts/migrate-credentials.js POLK_AHJ_ID and prior Polk diagnostics):
--   6d54bac8-9306-4fb4-b042-fbe086c007f2
--
-- Known gap (follow-up seed, do not invent roles here):
--   Affidavit document_role rows (e.g. owners_affidavit / roofing_affidavit) are
--   intentionally omitted until blank templates are sourced and
--   template_storage_path values are available.
--
-- Not seeded by design:
--   combined_packet — merge output, not an input requirement
--   permit application form — Polk Documents step is acknowledgement-only;
--     plans/supporting docs upload after submit (post_submit_upload phase),
--     not a distinct pre-submit application PDF requirement

BEGIN;

-- Notice of Commencement (recorded) — required before/at filing; no permit number yet
INSERT INTO public.ahj_document_requirements (
  ahj_id,
  document_role,
  display_name,
  required,
  requires_permit_number,
  sort_order
)
SELECT
  '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid,
  'notice_of_commencement',
  'Notice of Commencement (Recorded)',
  true,
  false,
  10
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ahj_document_requirements AS existing
  WHERE existing.ahj_id = '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid
    AND existing.document_role = 'notice_of_commencement'
);

-- Product approval(s) — required packet content; not permit-number dependent
INSERT INTO public.ahj_document_requirements (
  ahj_id,
  document_role,
  display_name,
  required,
  requires_permit_number,
  sort_order
)
SELECT
  '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid,
  'product_approval',
  'Product Approval',
  true,
  false,
  20
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ahj_document_requirements AS existing
  WHERE existing.ahj_id = '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid
    AND existing.document_role = 'product_approval'
);

-- Approved / issued permit — only after a permit number exists
INSERT INTO public.ahj_document_requirements (
  ahj_id,
  document_role,
  display_name,
  required,
  requires_permit_number,
  sort_order
)
SELECT
  '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid,
  'approved_permit',
  'Approved Permit',
  true,
  true,
  30
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ahj_document_requirements AS existing
  WHERE existing.ahj_id = '6d54bac8-9306-4fb4-b042-fbe086c007f2'::uuid
    AND existing.document_role = 'approved_permit'
);

COMMIT;
