require('dotenv').config({ path: '.env.local' })

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

function validateDevEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim())

  if (missing.length === 0) {
    return { ok: true, missing: [] }
  }

  console.warn('\n⚠  Missing required environment variables:')
  for (const key of missing) {
    console.warn(`   · ${key}`)
  }
  console.warn('\n   Add them to .env.local before using auth or Supabase features.\n')

  return { ok: false, missing }
}

if (require.main === module) {
  validateDevEnv()
  process.exit(0)
}

module.exports = { validateDevEnv }
