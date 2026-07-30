-- Per-job document folder: permit number + AHJ document requirements
-- 2026-07-30

alter table jobs add column if not exists permit_number text;
alter table jobs add column if not exists permit_issued_at timestamptz;

create table if not exists ahj_document_requirements (
  id uuid primary key default gen_random_uuid(),
  ahj_id uuid references ahj_portals(id),
  document_role text not null,
  display_name text not null,
  required boolean default true,
  template_storage_path text,
  requires_permit_number boolean default false,
  field_map jsonb,
  sort_order integer default 0
);

create index if not exists idx_ahj_document_requirements_ahj
  on ahj_document_requirements (ahj_id, sort_order);

comment on table ahj_document_requirements is
  'Per-AHJ required document roles for the job document folder. document_role maps to job_documents.document_type.';

comment on column jobs.permit_number is
  'Official AHJ permit / confirmation number set when permit is marked issued (not portal_confirmation draft JSON).';

comment on column jobs.permit_issued_at is
  'Timestamp when admin marked the permit issued.';
