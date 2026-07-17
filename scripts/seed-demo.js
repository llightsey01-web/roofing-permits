'use strict'

/**
 * Seed internal demo environment: Demo Roofing LLC + users + sample jobs/runs/logs.
 *
 * Usage: npm run seed:demo
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const DEMO_COMPANY_NAME = 'Demo Roofing LLC'
const DEMO_PASSWORD = 'Demo1234!'

const DEMO_USERS = [
  { email: 'demo.owner@dartiq.dev', full_name: 'Demo Owner' },
  { email: 'demo.admin2@dartiq.dev', full_name: 'Demo Admin Two' },
  { email: 'demo.admin3@dartiq.dev', full_name: 'Demo Admin Three' },
]

/**
 * Map requested demo statuses → real job_status / noc_status enums in this codebase.
 */
const DEMO_JOBS = [
  {
    label: 'ready',
    owner_name: 'Alice Ready',
    property_address: '101 Orange Ave',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'ready',
    noc_status: 'not_started',
    noc_file_path: null,
    run: { run_type: 'permit_phase_1', run_status: 'queued' },
  },
  {
    label: 'ready',
    owner_name: 'Bob Ready',
    property_address: '220 Lake Mirror Dr',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'ready',
    noc_status: 'not_started',
    noc_file_path: null,
    run: { run_type: 'permit_phase_1', run_status: 'queued' },
  },
  {
    label: 'noc_generating',
    owner_name: 'Carol NOC',
    property_address: '45 S Florida Ave',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'automation_running',
    noc_status: 'not_started',
    noc_file_path: null,
    run: { run_type: 'noc_generate', run_status: 'running' },
  },
  {
    label: 'noc_generating',
    owner_name: 'Dan NOC',
    property_address: '812 Memorial Blvd',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'automation_running',
    noc_status: 'generated',
    noc_file_path: 'demo/noc/dan-noc-placeholder.pdf',
    run: { run_type: 'noc_generate', run_status: 'running' },
  },
  {
    label: 'awaiting_notarization',
    owner_name: 'Eve Notary',
    property_address: '1500 Harden Blvd',
    property_city: 'Lakeland',
    property_zip: '33803',
    job_status: 'waiting_for_noc',
    noc_status: 'sent_for_notarization',
    noc_file_path: 'demo/noc/eve-noc-placeholder.pdf',
    run: { run_type: 'proof_check', run_status: 'running' },
  },
  {
    label: 'awaiting_notarization',
    owner_name: 'Frank Notary',
    property_address: '3300 Cleveland Heights Blvd',
    property_city: 'Lakeland',
    property_zip: '33803',
    job_status: 'waiting_for_noc',
    noc_status: 'sent_to_homeowner',
    noc_file_path: 'demo/noc/frank-noc-placeholder.pdf',
    run: { run_type: 'proof_check', run_status: 'queued' },
  },
  {
    label: 'permit_submitted',
    owner_name: 'Grace Submitted',
    property_address: '900 Edgewater Dr',
    property_city: 'Lakeland',
    property_zip: '33803',
    job_status: 'submitted',
    noc_status: 'recorded',
    noc_file_path: 'demo/noc/grace-noc-placeholder.pdf',
    // DB run_status enum: queued | running | error | needs_review (no "complete")
    run: { run_type: 'permit_submit', run_status: 'needs_review' },
  },
  {
    label: 'permit_approved',
    owner_name: 'Hank Approved',
    property_address: '412 Success Ln',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'permit_issued',
    noc_status: 'recorded',
    noc_file_path: 'demo/noc/hank-noc-placeholder.pdf',
    run: { run_type: 'permit_submit', run_status: 'needs_review' },
  },
  {
    label: 'needs_manual_review',
    owner_name: 'Iris Review',
    property_address: '77 Review Ct',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'needs_review',
    noc_status: 'recorded',
    noc_file_path: 'demo/noc/iris-noc-placeholder.pdf',
    run: { run_type: 'permit_phase_1', run_status: 'needs_review' },
  },
  {
    label: 'failed',
    owner_name: 'Jake Failed',
    property_address: '13 Error Way',
    property_city: 'Lakeland',
    property_zip: '33801',
    job_status: 'needs_correction',
    noc_status: 'error',
    noc_file_path: 'demo/noc/jake-noc-placeholder.pdf',
    run: { run_type: 'noc_generate', run_status: 'error', error_message: 'Demo failure: captcha timeout' },
  },
]

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function findAuthUserByEmail(supabase, email) {
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const match = (data.users || []).find(function (u) {
      return u.email && u.email.toLowerCase() === email.toLowerCase()
    })
    if (match) return match
    if ((data.users || []).length < 200) break
    page += 1
  }
  return null
}

async function ensureDemoUser(supabase, companyId, userDef) {
  let authUser = await findAuthUserByEmail(supabase, userDef.email)

  if (authUser) {
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      email: userDef.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        role: 'company_admin',
        company_id: companyId,
        full_name: userDef.full_name,
      },
    })
    if (error) throw error
    authUser = data.user
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: userDef.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'company_admin',
        company_id: companyId,
        full_name: userDef.full_name,
      },
    })
    if (error) throw error
    authUser = data.user
  }

  const { error: upsertError } = await supabase.from('users').upsert({
    id: authUser.id,
    email: userDef.email,
    role: 'company_admin',
    company_id: companyId,
    full_name: userDef.full_name,
  }, { onConflict: 'id' })

  if (upsertError) throw upsertError
  return authUser
}

async function ensureDemoCompany(supabase) {
  const { data: existing, error: findError } = await supabase
    .from('companies')
    .select('*')
    .eq('is_demo', true)
    .limit(1)
    .maybeSingle()

  if (findError) throw findError

  const payload = {
    name: DEMO_COMPANY_NAME,
    dba_name: 'Demo Roofing',
    license_number: 'CCC9999999',
    qualifier_name: 'Demo Qualifier',
    qualifier_license: 'CCC9999999',
    primary_email: DEMO_USERS[0].email,
    phone: '863-555-0100',
    address: '500 Demo Parkway',
    city: 'Lakeland',
    state: 'FL',
    zip: '33801',
    is_active: true,
    is_demo: true,
    onboarding_status: 'complete',
    onboarding_step: 5,
    subscription_plan: 'starter',
    subscription_status: 'active',
    covered_counties: ['polk', 'lee'],
    review_gates: {
      auto_approve_all: true,
      noc_before_send: false,
      permit_before_submit: false,
    },
    notes: 'Internal demo company — safe to reset via npm run seed:reset-demo',
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { data, error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('companies')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function seedJobsForCompany(supabase, company, createdByUserId) {
  const { count, error: countError } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company.id)

  if (countError) throw countError
  if (count && count > 0) {
    console.log('Demo company already has', count, 'jobs — skipping job seed (use seed:reset-demo for a fresh set)')
    return { created: 0, skipped: true }
  }

  let created = 0
  for (let i = 0; i < DEMO_JOBS.length; i++) {
    const spec = DEMO_JOBS[i]
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        company_id: company.id,
        created_by: createdByUserId,
        owner_name: spec.owner_name,
        owner_email: 'homeowner+' + i + '@dartiq.dev',
        owner_phone: '863-555-01' + String(10 + i).slice(-2),
        property_address: spec.property_address,
        property_city: spec.property_city,
        property_state: 'FL',
        property_zip: spec.property_zip,
        job_status: spec.job_status,
        noc_status: spec.noc_status,
        noc_option: 'auto_generate',
        noc_file_path: spec.noc_file_path,
        roof_type: 'shingle',
        valuation: 8500 + i * 500,
        scope_of_work: 'Demo roof replacement — ' + spec.label,
        internal_notes: 'Seeded demo job (' + spec.label + ')',
        job_specs: { squares: 20 + i, demo_label: spec.label },
        roof_specs: {
          primary_material: {
            manufacturer: 'Demo Shingles Co',
            product_name: 'Demo Architectural',
            approval_number: 'FL12345',
          },
        },
      })
      .select('id')
      .single()

    if (jobError) throw new Error('Failed to insert demo job: ' + jobError.message)

    const now = new Date()
    const startedAt = new Date(now.getTime() - (60 + i * 5) * 60 * 1000).toISOString()
    const completedAt = ['complete', 'error', 'needs_review'].includes(spec.run.run_status)
      ? new Date(now.getTime() - i * 5 * 60 * 1000).toISOString()
      : null

    const runPayload = {
      job_id: job.id,
      run_type: spec.run.run_type,
      run_status: spec.run.run_status,
      started_at: startedAt,
      completed_at: completedAt,
      attempts: 1,
      error_message: spec.run.error_message || null,
    }

    const { data: run, error: runError } = await supabase
      .from('automation_runs')
      .insert(runPayload)
      .select('id')
      .single()

    if (runError) throw new Error('Failed to insert demo run: ' + runError.message)

    const logRows = [
      {
        run_id: run.id,
        step_number: 1,
        step_name: 'demo_start',
        success: true,
        notes: 'Demo seed: started ' + spec.run.run_type,
      },
      {
        run_id: run.id,
        step_number: 2,
        step_name: 'demo_status',
        success: spec.run.run_status !== 'error',
        notes: 'Demo seed status: ' + spec.run.run_status + ' (' + spec.label + ')',
        raw_error: spec.run.error_message || null,
      },
    ]

    const { error: logError } = await supabase.from('automation_logs').insert(logRows)
    if (logError) throw new Error('Failed to insert demo logs: ' + logError.message)

    created += 1
  }

  return { created, skipped: false }
}

async function seedDemo() {
  const supabase = getSupabase()
  console.log('Seeding demo environment...')

  const company = await ensureDemoCompany(supabase)
  console.log('Demo company:', company.id, company.name)

  const authUsers = []
  for (let i = 0; i < DEMO_USERS.length; i++) {
    const user = await ensureDemoUser(supabase, company.id, DEMO_USERS[i])
    authUsers.push(user)
    console.log('Demo user ready:', DEMO_USERS[i].email)
  }

  if (authUsers[0]) {
    await supabase
      .from('companies')
      .update({ owner_user_id: authUsers[0].id })
      .eq('id', company.id)
  }

  const jobResult = await seedJobsForCompany(supabase, company, authUsers[0].id)
  if (!jobResult.skipped) {
    console.log('Created', jobResult.created, 'demo jobs with runs + logs')
  }

  console.log('')
  console.log('Demo login:')
  console.log('  Email:   ', DEMO_USERS[0].email)
  console.log('  Password:', DEMO_PASSWORD)
  console.log('  (also)  ', DEMO_USERS[1].email, '/', DEMO_USERS[2].email)
  console.log('Done.')
  return { company, users: authUsers, jobs: jobResult }
}

async function deleteDemoData() {
  const supabase = getSupabase()
  console.log('Finding demo companies...')

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name')
    .eq('is_demo', true)

  if (error) throw error
  if (!companies || companies.length === 0) {
    console.log('No demo companies found.')
    return { deletedCompanies: 0 }
  }

  for (let c = 0; c < companies.length; c++) {
    const company = companies[c]
    console.log('Resetting demo company:', company.name, company.id)

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('company_id', company.id)

    const jobIds = (jobs || []).map(function (j) { return j.id })

    if (jobIds.length > 0) {
      const { data: runs } = await supabase
        .from('automation_runs')
        .select('id')
        .in('job_id', jobIds)

      const runIds = (runs || []).map(function (r) { return r.id })
      if (runIds.length > 0) {
        await supabase.from('automation_logs').delete().in('run_id', runIds)
        await supabase.from('automation_runs').delete().in('id', runIds)
      }
      await supabase.from('jobs').delete().in('id', jobIds)
      console.log('  Deleted', jobIds.length, 'jobs (+ runs/logs)')
    }

    await supabase.from('company_credentials').delete().eq('company_id', company.id)

    // Clear FK so auth users can be deleted
    await supabase
      .from('companies')
      .update({ owner_user_id: null })
      .eq('id', company.id)

    const { data: userRows } = await supabase
      .from('users')
      .select('id, email')
      .eq('company_id', company.id)

    for (let u = 0; u < (userRows || []).length; u++) {
      const row = userRows[u]
      await supabase.from('users').delete().eq('id', row.id)
      const { error: authDelError } = await supabase.auth.admin.deleteUser(row.id)
      if (authDelError) {
        console.warn('  Warning: could not delete auth user', row.email, authDelError.message)
      } else {
        console.log('  Deleted user', row.email)
      }
    }

    // Also clean known demo emails that might not be linked yet
    for (let e = 0; e < DEMO_USERS.length; e++) {
      const authUser = await findAuthUserByEmail(supabase, DEMO_USERS[e].email)
      if (authUser) {
        await supabase.from('users').delete().eq('id', authUser.id)
        await supabase.auth.admin.deleteUser(authUser.id)
      }
    }

    await supabase.from('companies').delete().eq('id', company.id)
    console.log('  Deleted company')
  }

  return { deletedCompanies: companies.length }
}

module.exports = {
  DEMO_COMPANY_NAME,
  DEMO_PASSWORD,
  DEMO_USERS,
  DEMO_JOBS,
  seedDemo,
  deleteDemoData,
  getSupabase,
}

if (require.main === module) {
  seedDemo().catch(function (err) {
    console.error('seed-demo failed:', err.message)
    process.exit(1)
  })
}
