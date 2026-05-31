require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const EMAIL = 'contractor-test@ahjiq.com'
const PASSWORD = 'Test1234!'
const COMPANY_ID = '384062a1-38eb-4612-a01c-6ae467d5d22f'
const ROLE = 'company_admin'

async function findAuthUserByEmail(supabase, email) {
  let page = 1
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < 200) break
    page += 1
  }
  return null
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  let authUser = await findAuthUserByEmail(supabase, EMAIL)

  if (authUser) {
    console.log('Auth user exists — reusing id:', authUser.id)
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        role: ROLE,
        company_id: COMPANY_ID,
      },
    })
    if (error) throw error
    authUser = data.user
  } else {
    console.log('Auth user missing — creating')
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: ROLE,
        company_id: COMPANY_ID,
        full_name: 'Contractor Test',
      },
    })
    if (error) throw error
    authUser = data.user
    console.log('Created auth user id:', authUser.id)
  }

  const { data: existingRow } = await supabase
    .from('users')
    .select('id, email, role, company_id')
    .eq('id', authUser.id)
    .maybeSingle()

  const rowPayload = {
    id: authUser.id,
    email: EMAIL,
    role: ROLE,
    company_id: COMPANY_ID,
    full_name: existingRow?.full_name || 'Contractor Test',
  }

  if (existingRow) {
    console.log('users row exists — updating role and company_id')
    const { error } = await supabase.from('users').update({
      email: EMAIL,
      role: ROLE,
      company_id: COMPANY_ID,
    }).eq('id', authUser.id)
    if (error) throw error
  } else {
    console.log('users row missing — inserting')
    const { error } = await supabase.from('users').insert(rowPayload)
    if (error) throw error
  }

  const { data: finalRow, error: fetchError } = await supabase
    .from('users')
    .select('email, role, company_id')
    .eq('id', authUser.id)
    .single()

  if (fetchError) throw fetchError

  console.log('\nFinal user row:')
  console.log(JSON.stringify(finalRow, null, 2))
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
