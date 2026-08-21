// tests/unit/zig14-jobs-ahj-id-index.test.js
// ZIG-14: static parity for tracked jobs.ahj_id index + production artifact.
'use strict'

const fs = require('fs')
const path = require('path')

var INDEX_CREATE =
  /CREATE INDEX IF NOT EXISTS idx_jobs_ahj_id\s+ON public\.jobs USING btree \(ahj_id\);/

var migrationPath = path.join(
  __dirname,
  '../../supabase/migrations/20260821010000_zig14_jobs_ahj_id_index.sql'
)
var prodPath = path.join(
  __dirname,
  '../../scripts/sql/zig-14-production-jobs-ahj-id-index.sql'
)

function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

function createIndexStatements(sql) {
  return stripSqlComments(sql).match(/CREATE\s+(UNIQUE\s+)?INDEX[\s\S]*?;/gi) || []
}

describe('ZIG-14 jobs.ahj_id index parity', function () {
  var migration = fs.readFileSync(migrationPath, 'utf8')
  var prod = fs.readFileSync(prodPath, 'utf8')

  test('tracked index name, table, column, and btree shape', function () {
    expect(migration).toMatch(INDEX_CREATE)
    expect(migration).toMatch(/idx_jobs_ahj_id/)
    expect(migration).toMatch(/ON public\.jobs USING btree \(ahj_id\)/)
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX/i)
  })

  test('migration is idempotent via IF NOT EXISTS', function () {
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_ahj_id/)
    expect(createIndexStatements(migration)).toHaveLength(1)
  })

  test('does not introduce a second differently named jobs.ahj_id index', function () {
    var creates = createIndexStatements(migration).concat(createIndexStatements(prod))
    expect(creates).toHaveLength(2)
    creates.forEach(function (stmt) {
      expect(stmt).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_ahj_id/)
      expect(stmt).toMatch(/ON public\.jobs USING btree \(ahj_id\)/)
      expect(stmt).not.toMatch(/CREATE UNIQUE INDEX/i)
      expect(stmt).not.toMatch(/jobs_ahj_id_idx/)
    })
  })

  test('no schema changes beyond this index', function () {
    ;[migration, prod].forEach(function (sql) {
      var executable = stripSqlComments(sql)
      expect(executable).not.toMatch(/ALTER TABLE/i)
      expect(executable).not.toMatch(/DROP /i)
      expect(executable).not.toMatch(/FOREIGN KEY/i)
      expect(executable).not.toMatch(/ADD COLUMN/i)
      expect(executable).not.toMatch(/CREATE TABLE/i)
    })
  })

  test('production artifact is Logan-manual, no-op expected, and matches migration SQL', function () {
    expect(prod).toMatch(/FOR LOGAN MANUAL REVIEW AND EXECUTION ONLY/)
    expect(prod).toMatch(/Do not run via agent/)
    expect(prod).toMatch(/Production currently already has idx_jobs_ahj_id/)
    expect(prod).toMatch(/Expected execution result today: no-op/)
    expect(prod).toMatch(/tracked parity \/ manual verification only/)
    expect(prod).toMatch(/Production execution requires Logan approval/)
    expect(prod).toMatch(INDEX_CREATE)
    expect(prod).toMatch(
      /SELECT indexname, indexdef\s+FROM pg_indexes\s+WHERE schemaname = 'public'\s+AND tablename = 'jobs'\s+AND indexname = 'idx_jobs_ahj_id';/
    )
  })
})
