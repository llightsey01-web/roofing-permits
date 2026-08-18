// tests/unit/job-documents-canonical-schema.test.js
// ZIG-11: job_documents + document_type canonical schema ownership
'use strict'

const fs = require('fs')
const path = require('path')

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260818120000_job_documents_canonical_schema.sql'
)
var prodPath = path.join(
  __dirname,
  '../../scripts/sql/zig-11-production-job-documents-parity.sql'
)

var CANONICAL_LABELS = [
  'contractor_license',
  'qualifier_license',
  'insurance_certificate',
  'notice_of_commencement',
  'owners_affidavit',
  'product_approval',
  'site_plan',
  'photo_existing_roof',
  'signed_contract',
  'other',
  'approved_permit',
  'combined_packet',
  'permit_screenshot',
  'noc_uploaded_signed',
  'noc_uploaded_notarized',
  'noc_uploaded_recorded',
  'submission_packet',
]

var EXCLUDED_LABELS = [
  'gl_certificate',
  'wc_certificate',
  'contractor_signature',
  'noc_recorded',
  'permit_application',
  'roofing_affidavit',
]

/** DB-written document_type literals from verified writers (not settings anti-pattern). */
var WRITER_DOCUMENT_TYPES = {
  'app/api/contractor/jobs/[id]/upload-noc/route.js': [
    'noc_uploaded_signed',
    'noc_uploaded_notarized',
    'noc_uploaded_recorded',
  ],
  'app/api/admin/jobs/[id]/mark-issued/route.js': ['approved_permit'],
  'lib/documents/packet-merge.js': ['combined_packet'],
  'app/jobs/[id]/page.js': [
    'contractor_license',
    'qualifier_license',
    'insurance_certificate',
    'notice_of_commencement',
    'owners_affidavit',
    'product_approval',
    'site_plan',
    'signed_contract',
  ],
  'lib/documents/affidavit-generate.js': ['owners_affidavit'],
}

describe('job_documents canonical schema (ZIG-11)', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')

  test('migration declares tracked canonical ownership (forward-only)', function () {
    expect(migration).toMatch(
      /establishes tracked canonical ownership of public\.job_documents/
    )
    expect(migration).toMatch(/forward-only convergence[\s\S]*migration/)
    expect(migration).toMatch(/not a replay of historical migrations/)
    expect(migration).not.toMatch(/DROP TABLE\s+.*job_documents/i)
  })

  test('migration creates or converges public.document_type', function () {
    expect(migration).toMatch(/CREATE TYPE public\.document_type AS ENUM/)
    expect(migration).toMatch(
      /ALTER TYPE public\.document_type ADD VALUE IF NOT EXISTS 'submission_packet'/
    )
    expect(migration).toMatch(/submission_packet is reserved/)
    expect(migration).toMatch(/No ZIG-11 writer uses it/)
    expect(migration).toMatch(/job_id = companyId anti-pattern/)
  })

  test('migration includes all canonical columns and FKs', function () {
    ;[
      'job_id',
      'document_type',
      'file_name',
      'file_path',
      'file_size_bytes',
      'mime_type',
      'uploaded_by',
      'uploaded_at',
    ].forEach(function (col) {
      expect(migration).toMatch(new RegExp('\\b' + col + '\\b'))
    })
    expect(migration).toMatch(
      /FOREIGN KEY \(job_id\) REFERENCES public\.jobs\(id\) ON DELETE CASCADE/
    )
    expect(migration).toMatch(
      /FOREIGN KEY \(uploaded_by\) REFERENCES public\.users\(id\) ON DELETE SET NULL/
    )
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_job_docs_job_id\s+ON public\.job_documents \(job_id\)/
    )
  })

  test('migration enables intentional zero-policy RLS (no tenant policies)', function () {
    expect(migration).toMatch(
      /ALTER TABLE public\.job_documents ENABLE ROW LEVEL SECURITY/
    )
    expect(migration).toMatch(
      /Direct authenticated\/PostgREST access is intentionally denied by RLS with zero policies/
    )
    expect(migration).toMatch(
      /Legitimate access occurs through trusted server\/service-role paths/
    )
    expect(migration).not.toMatch(/CREATE POLICY/i)
    expect(migration).not.toMatch(/ahj_document_requirement_id/)
    expect(migration).not.toMatch(/\bcompany_id\b/)
  })

  test('canonical enum is exactly the approved 17 labels', function () {
    expect(CANONICAL_LABELS).toHaveLength(17)
    CANONICAL_LABELS.forEach(function (label) {
      expect(migration).toContain("'" + label + "'")
    })
    EXCLUDED_LABELS.forEach(function (label) {
      // May appear in comments explaining exclusion — must not appear as enum literals
      var enumLiteral = new RegExp("'" + label + "'")
      var createBlock = migration.match(
        /CREATE TYPE public\.document_type AS ENUM \(([\s\S]*?)\);/
      )
      expect(createBlock).not.toBeNull()
      expect(createBlock[1]).not.toMatch(enumLiteral)
      expect(migration).not.toMatch(
        new RegExp("ADD VALUE IF NOT EXISTS '" + label + "'")
      )
    })
  })

  test('production artifact is additive enum-only delta (no column rewrite)', function () {
    expect(prod).toMatch(/FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY/)
    expect(prod).toMatch(
      /ALTER TYPE public\.document_type ADD VALUE IF NOT EXISTS 'submission_packet'/
    )
    expect(prod).toMatch(/zero policies/)
    expect(prod).toMatch(
      /Direct authenticated\/PostgREST access is intentionally denied by RLS with zero policies/
    )
    expect(prod).not.toMatch(/ALTER COLUMN document_type TYPE/i)
    expect(prod).not.toMatch(/^\s*ADD COLUMN/im)
    expect(prod).not.toMatch(/DROP TABLE/i)
    expect(prod).not.toMatch(/CREATE POLICY/i)
    expect(prod).not.toMatch(/ahj_document_requirement_id/)
  })

  test('verified writers only emit canonical enum labels', function () {
    Object.keys(WRITER_DOCUMENT_TYPES).forEach(function (rel) {
      var src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
      expect(src.length).toBeGreaterThan(0)
      WRITER_DOCUMENT_TYPES[rel].forEach(function (label) {
        expect(CANONICAL_LABELS).toContain(label)
        if (rel.indexOf('upload-noc') !== -1) {
          expect(src).toMatch(/noc_uploaded_/)
        } else if (rel.indexOf('affidavit-generate') !== -1) {
          expect(src).toMatch(/document_type:\s*requirement\.document_role/)
        } else {
          expect(src).toContain("'" + label + "'")
        }
      })
    })

    // upload-noc builds noc_uploaded_{signed|notarized|recorded}
    var uploadNoc = fs.readFileSync(
      path.join(__dirname, '../../app/api/contractor/jobs/[id]/upload-noc/route.js'),
      'utf8'
    )
    expect(uploadNoc).toMatch(
      /document_type:\s*'noc_uploaded_' \+ nocOption\.replace\('upload_', ''\)/
    )
    ;['signed', 'notarized', 'recorded'].forEach(function (suffix) {
      expect(CANONICAL_LABELS).toContain('noc_uploaded_' + suffix)
    })
  })

  test('RLS intent: fail-closed authenticated path; service-role remains intended', function () {
    // Strongest offline assertion available without live PostgREST credentials:
    // migration must not introduce policies that would open authenticated access,
    // and must document deny-all RLS + service-role access path.
    // Live staging after apply additionally confirms:
    //   relrowsecurity=true, policy_count=0, authenticated/anon bypassrls=false,
    //   service_role bypassrls=true (grants unchanged; no widen).
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(migration).not.toMatch(/CREATE POLICY/)
    expect(migration).toMatch(/service-role paths/)
    expect(prod).not.toMatch(/CREATE POLICY/)
    expect(prod).toMatch(/ENABLE ROW LEVEL SECURITY/)

    // Settings anti-pattern labels must stay out of the DB enum (documented).
    EXCLUDED_LABELS.slice(0, 3).forEach(function (label) {
      expect(CANONICAL_LABELS).not.toContain(label)
    })
  })
})
