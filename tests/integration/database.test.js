// tests/integration/database.test.js
'use strict'

const { supabase } = require('../setup')

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

describe('database integration', function () {
  beforeAll(function () {
    if (!hasSupabase) {
      console.warn('[database.test] Skipping — Supabase env vars not set')
    }
  })

  test('Supabase connection works', async function () {
    if (!hasSupabase) return
    const { error } = await supabase.from('jobs').select('id').limit(1)
    expect(error).toBeNull()
  })

  test('jobs table is accessible', async function () {
    if (!hasSupabase) return
    const { data, error } = await supabase
      .from('jobs')
      .select('id, owner_name, property_address, job_status')
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('automation_runs table has expected columns', async function () {
    if (!hasSupabase) return
    const { data, error } = await supabase
      .from('automation_runs')
      .select('id, job_id, run_type, run_status, attempts, started_at, completed_at, payload')
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('company_credentials table exists', async function () {
    if (!hasSupabase) return
    const { error } = await supabase.from('company_credentials').select('id').limit(1)
    expect(error).toBeNull()
  })
})
