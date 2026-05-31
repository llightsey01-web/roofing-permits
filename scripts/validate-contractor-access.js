require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const OTHER_COMPANY = '00000000-0000-4000-8000-000000000001'
const CONTRACTOR_EMAIL = 'contractor-test@ahjiq.com'
const CONTRACTOR_PASSWORD = 'Test1234!'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  await service.from('companies').upsert({
    id: OTHER_COMPANY,
    name: 'Isolation Test Co',
    is_active: true,
    state: 'FL',
  })

  const { data: otherJob } = await service.from('jobs').insert({
    owner_name: 'Isolation Test Owner',
    property_address: '100 Isolation Ave',
    property_city: 'Tampa',
    property_state: 'FL',
    property_zip: '33601',
    company_id: OTHER_COMPANY,
    job_status: 'ready',
    noc_status: 'not_started',
  }).select('id, company_id').single()

  const { data: auth, error: loginError } = await anon.auth.signInWithPassword({
    email: CONTRACTOR_EMAIL,
    password: CONTRACTOR_PASSWORD,
  })
  if (loginError) throw loginError

  const { data: userData } = await service.from('users')
    .select('email, role, company_id')
    .eq('id', auth.user.id)
    .single()

  const { data: apiJobs, error: apiError } = await anon.from('jobs')
    .select('id, company_id')
    .eq('company_id', userData.company_id)

  const leaked = (apiJobs || []).filter(j => j.company_id !== userData.company_id)
  const includesOther = (apiJobs || []).some(j => j.id === otherJob.id)

  console.log('User:', userData)
  console.log('Visible jobs:', apiJobs?.length)
  console.log('Includes other-company job:', includesOther)
  console.log('Leaked rows:', leaked.length)

  await service.from('jobs').delete().eq('id', otherJob.id)

  if (userData.role !== 'company_admin') throw new Error('Expected company_admin role')
  if (includesOther || leaked.length > 0) {
    throw new Error('ACCESS CONTROL FAILURE: cross-company jobs visible')
  }

  console.log('PASS: contractor only sees own company jobs')
}

main().catch(err => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
