// tests/unit/job-documents-requirement-identity.test.js
// ZIG-17 PR 1 schema contract
'use strict'

const fs = require('fs')
const path = require('path')

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260819140000_job_documents_requirement_identity.sql'
)
var prodPath = path.join(
  __dirname,
  '../../scripts/sql/zig-17-pr1-production-job-documents-requirement-identity.sql'
)
var zig11Path = path.join(
  __dirname,
  '../../supabase/migrations/20260818120000_job_documents_canonical_schema.sql'
)

describe('job_documents requirement identity (ZIG-17 PR 1)', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')
  var zig11 = fs.readFileSync(zig11Path, 'utf8')

  test('adds nullable ahj_document_requirement_id only', function () {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS ahj_document_requirement_id uuid/
    )
    expect(migration).not.toMatch(/\bfingerprint\b/)
    expect(migration).not.toMatch(/\bcompany_id\b/)
    expect(migration).not.toMatch(/document_role/)
    expect(migration).not.toMatch(/ADD VALUE/)
    expect(migration).not.toMatch(/UPDATE public\.job_documents/)
    expect(migration).toMatch(/No backfill/)
    expect(migration).not.toMatch(/UPDATE[\s\S]*job_documents[\s\S]*SET/)
  })

  test('FK is ON DELETE SET NULL', function () {
    expect(migration).toMatch(
      /job_documents_ahj_document_requirement_id_fkey/
    )
    expect(migration).toMatch(
      /REFERENCES public\.ahj_document_requirements\(id\)/
    )
    expect(migration).toMatch(/ON DELETE SET NULL/)
  })

  test('partial unique index is scoped to non-null requirement IDs', function () {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS job_documents_job_id_requirement_id_uidx/
    )
    expect(migration).toMatch(
      /ON public\.job_documents \(job_id, ahj_document_requirement_id\)/
    )
    expect(migration).toMatch(
      /WHERE ahj_document_requirement_id IS NOT NULL/
    )
  })

  test('NOC identity unique is limited to the four canonical NOC types', function () {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS job_documents_job_id_noc_document_type_uidx/
    )
    expect(migration).toMatch(
      /ON public\.job_documents \(job_id, document_type\)\s+WHERE document_type IN \(/
    )
    var nocWhere = migration.match(
      /job_documents_job_id_noc_document_type_uidx[\s\S]*?WHERE document_type IN \(([\s\S]*?)\);/
    )
    expect(nocWhere).not.toBeNull()
    ;[
      'notice_of_commencement',
      'noc_uploaded_signed',
      'noc_uploaded_notarized',
      'noc_uploaded_recorded',
    ].forEach(function (label) {
      expect(nocWhere[1]).toContain("'" + label + "'")
    })
    expect(nocWhere[1]).not.toMatch(/'combined_packet'/)
    expect(nocWhere[1]).not.toMatch(/'submission_packet'/)
    expect(nocWhere[1]).not.toMatch(/'contractor_license'/)
    expect(nocWhere[1]).not.toMatch(/'product_approval'/)
    expect(migration).not.toMatch(
      /ADD CONSTRAINT \S+\s+UNIQUE\s*\(\s*job_id\s*,\s*document_type\s*\)/
    )
    expect(migration).toMatch(/RAISE EXCEPTION/)
    expect(migration).toMatch(/no destructive dedupe/)
  })

  test('null ahj_document_requirement_id remains allowed', function () {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS ahj_document_requirement_id uuid;/
    )
    expect(migration).not.toMatch(
      /ALTER COLUMN ahj_document_requirement_id SET NOT NULL/
    )
  })

  test('existing ZIG-11 table definition is not rewritten', function () {
    expect(zig11).not.toMatch(/ahj_document_requirement_id/)
    expect(migration).toMatch(/No backfill/)
  })

  test('production artifact matches staging intent', function () {
    expect(prod).toMatch(/FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY/)
    expect(prod).toMatch(/ADD COLUMN IF NOT EXISTS ahj_document_requirement_id uuid/)
    expect(prod).toMatch(/ON DELETE SET NULL/)
    expect(prod).toMatch(/WHERE ahj_document_requirement_id IS NOT NULL/)
    expect(prod).toMatch(/job_documents_job_id_noc_document_type_uidx/)
    expect(prod).toMatch(/Duplicate canonical NOC groups/)
    expect(prod).not.toMatch(/DROP TABLE/i)
    expect(prod).not.toMatch(/CREATE POLICY/i)
  })
})
