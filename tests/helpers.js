// tests/helpers.js — Shared test helpers
const { supabase } = require('./setup')

const TEST_PREFIX = 'jest-test-'

async function createTestCompany(overrides) {
  const row = Object.assign({
    name: TEST_PREFIX + 'Company ' + Date.now(),
    is_active: true,
    state: 'FL',
    address: '100 Test St',
    city: 'Tampa',
    zip: '33601',
  }, overrides || {})

  const { data, error } = await supabase.from('companies').insert(row).select('id').single()
  if (error) throw new Error('createTestCompany failed: ' + error.message)
  return data.id
}

async function cleanupTestCompany(companyId) {
  if (!companyId) return
  const { data: jobs } = await supabase.from('jobs').select('id').eq('company_id', companyId)
  if (jobs) {
    for (var i = 0; i < jobs.length; i++) {
      await cleanupTestJob(jobs[i].id)
    }
  }
  await supabase.from('companies').delete().eq('id', companyId)
}

async function createTestJob(companyId, overrides) {
  const row = Object.assign({
    owner_name: TEST_PREFIX + 'Owner',
    owner_email: 'test-owner@example.com',
    property_address: '100 Test Ave',
    property_city: 'Tampa',
    property_state: 'FL',
    property_zip: '33601',
    company_id: companyId || null,
    job_status: 'ready',
    noc_status: 'not_started',
  }, overrides || {})

  const { data, error } = await supabase.from('jobs').insert(row).select('id').single()
  if (error) throw new Error('createTestJob failed: ' + error.message)
  return data.id
}

async function cleanupTestJob(jobId) {
  if (!jobId) return
  const { data: runs } = await supabase.from('automation_runs').select('id').eq('job_id', jobId)
  if (runs && runs.length) {
    const runIds = runs.map(function (r) { return r.id })
    await supabase.from('automation_logs').delete().in('run_id', runIds)
    await supabase.from('automation_runs').delete().eq('job_id', jobId)
  }
  await supabase.from('jobs').delete().eq('id', jobId)
}

async function waitForRunStatus(runId, status, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 30000)
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('automation_runs')
      .select('run_status')
      .eq('id', runId)
      .single()
    if (error) throw new Error('waitForRunStatus query failed: ' + error.message)
    if (data && data.run_status === status) return data
    await new Promise(function (resolve) { setTimeout(resolve, 500) })
  }
  throw new Error('Timed out waiting for run ' + runId + ' to reach status ' + status)
}

module.exports = {
  TEST_PREFIX,
  createTestCompany,
  cleanupTestCompany,
  createTestJob,
  cleanupTestJob,
  waitForRunStatus,
}
