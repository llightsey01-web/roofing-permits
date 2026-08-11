#!/usr/bin/env node
/**
 * Offline mechanical validation for supabase/seeds/*.sql
 *
 * Prefer real PostgreSQL parse via pgsql-parser:
 *   npm install --no-save pgsql-parser
 *   node scripts/validate-seed-sql.mjs [path-to-seed.sql]
 *
 * Falls back to single-quote pairing checks if pgsql-parser is unavailable.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const DEFAULT_SEED = 'supabase/seeds/2026-08-11_accela_ahj_backlog.sql'
const seedPath = resolve(process.argv[2] || DEFAULT_SEED)
const sql = readFileSync(seedPath, 'utf8')

function fail(msg) {
  console.error('FAIL:', msg)
  process.exit(1)
}

function assertBalancedSingleQuotes(source) {
  let i = 0
  let line = 1
  let inLineComment = false
  let inString = false
  let stringStartLine = null
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\n') {
      line += 1
      inLineComment = false
      i += 1
      continue
    }
    if (inLineComment) {
      i += 1
      continue
    }
    if (!inString && ch === '-' && source[i + 1] === '-') {
      inLineComment = true
      i += 2
      continue
    }
    if (ch === "'") {
      if (!inString) {
        inString = true
        stringStartLine = line
        i += 1
        continue
      }
      if (source[i + 1] === "'") {
        i += 2
        continue
      }
      inString = false
      stringStartLine = null
      i += 1
      continue
    }
    i += 1
  }
  if (inString) {
    fail(`Unterminated single-quoted string starting near line ${stringStartLine}`)
  }
  console.log('fallback: single-quote pairing balanced')
}

async function loadPgsqlParser() {
  const require = createRequire(import.meta.url)
  try {
    return require('pgsql-parser')
  } catch {
    // also try cwd node_modules (e.g. npm install --no-save from repo root)
    try {
      const cwdRequire = createRequire(pathToFileURL(resolve('package.json')).href)
      return cwdRequire('pgsql-parser')
    } catch {
      return null
    }
  }
}

function stmtKind(wrap) {
  return Object.keys(wrap.stmt || {})[0] || 'unknown'
}

function insertRelation(insertStmt) {
  const rel = insertStmt.relation || {}
  const schema = rel.schemaname ? `${rel.schemaname}.` : ''
  return `${schema}${rel.relname || '?'}`
}

function notesFromInsert(insertStmt) {
  const cols = (insertStmt.cols || []).map((c) => c.ResTarget?.name)
  const notesIdx = cols.indexOf('notes')
  if (notesIdx < 0) return null
  const targets = insertStmt.selectStmt?.SelectStmt?.targetList || []
  return targets[notesIdx]?.ResTarget?.val?.A_Const?.sval?.sval ?? null
}

async function main() {
  console.log('seed:', seedPath)
  const parser = await loadPgsqlParser()
  if (!parser?.parse) {
    console.warn('pgsql-parser not installed; using quote-pairing fallback')
    console.warn('Install with: npm install --no-save pgsql-parser')
    assertBalancedSingleQuotes(sql)
    process.exit(0)
  }

  let result
  try {
    result = await parser.parse(sql)
  } catch (err) {
    fail(`pgsql-parser rejected file: ${err.message || err}`)
  }

  const stmts = result.stmts || []
  const kinds = stmts.map((s) => {
    const kind = stmtKind(s)
    if (kind === 'TransactionStmt') {
      const tk = s.stmt.TransactionStmt?.kind
      if (tk === 'TRANS_STMT_BEGIN') return 'BEGIN'
      if (tk === 'TRANS_STMT_COMMIT') return 'COMMIT'
      return `TransactionStmt:${tk}`
    }
    if (kind === 'InsertStmt') {
      return `INSERT ${insertRelation(s.stmt.InsertStmt)}`
    }
    return kind
  })

  console.log('parses clean: yes')
  console.log('statement sequence:')
  kinds.forEach((k, i) => console.log(`  ${i + 1}. ${k}`))

  if (kinds[0] !== 'BEGIN') fail('First statement must be BEGIN')
  if (kinds[kinds.length - 1] !== 'COMMIT') fail('Last statement must be COMMIT')
  const inserts = kinds.slice(1, -1)
  if (inserts.length !== 14) fail(`Expected 14 INSERTs, got ${inserts.length}`)
  if (!inserts.every((k) => k === 'INSERT public.ahj_portals')) {
    fail(`Unexpected INSERT targets: ${inserts.join(', ')}`)
  }

  const insertStmts = stmts.slice(1, -1).map((s) => s.stmt.InsertStmt)
  for (let i = 0; i < insertStmts.length; i++) {
    const notes = notesFromInsert(insertStmts[i])
    if (!notes || !notes.includes('backlog=2026-08-11')) {
      fail(`INSERT #${i + 1} notes missing backlog=2026-08-11: ${JSON.stringify(notes)}`)
    }
  }

  console.log('all 14 INSERT notes contain backlog=2026-08-11')
  console.log('OK')
}

main().catch((err) => {
  fail(err.stack || String(err))
})
