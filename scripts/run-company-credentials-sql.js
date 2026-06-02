#!/usr/bin/env node
// Run company_credentials migration SQL against Supabase Postgres
// Requires SUPABASE_DB_PASSWORD or DATABASE_URL in .env.local

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') })
const fs = require('fs')
const path = require('path')

async function main() {
  var sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260601_company_credentials.sql')
  var sql = fs.readFileSync(sqlPath, 'utf8')

  var connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!connectionString && process.env.SUPABASE_DB_PASSWORD && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    var ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
    connectionString = 'postgresql://postgres:' + encodeURIComponent(process.env.SUPABASE_DB_PASSWORD) +
      '@db.' + ref + '.supabase.co:5432/postgres'
  }

  if (!connectionString) {
    console.error('Missing DATABASE_URL or SUPABASE_DB_PASSWORD — cannot run DDL automatically.')
    console.error('Run this SQL manually in Supabase SQL editor:')
    console.error(sqlPath)
    process.exit(1)
  }

  var pg
  try {
    pg = require('pg')
  } catch (err) {
    console.error('Install pg to run migration: npm install pg')
    process.exit(1)
  }

  var client = new pg.Client({ connectionString: connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('company_credentials migration applied successfully')
  } finally {
    await client.end()
  }
}

main().catch(function(err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
