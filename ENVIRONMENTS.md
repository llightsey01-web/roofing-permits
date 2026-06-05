# DART iQ Environments

## Production

- **URL:** https://app.dartiq.dev
- **Database:** Supabase production project
- **Railway:** roofing-permits project (main branch)
- **Branch:** main
- **Deploy:** Auto on push to main

## Staging

- **URL:** https://staging.dartiq.dev (when configured)
- **Database:** Supabase staging project (separate)
- **Railway:** roofing-permits-staging project (staging branch)
- **Branch:** staging
- **Deploy:** Auto on push to staging

## Development

- **URL:** http://localhost:3000
- **Database:** Can use staging Supabase or local
- **Config:** .env.local

## Rules

1. NEVER test against production database
2. NEVER commit real credentials
3. All new features tested in staging before production
4. Hotfixes: branch from main, test locally, merge to main
5. Features: branch from main, test in staging, merge to main

## Adding a New Environment Variable

1. Add to .env.local (development)
2. Add to .env.staging.example (document it)
3. Add to .env.production.example (document it)
4. Add to Railway staging service variables
5. Add to Railway production service variables
6. Add to GitHub Actions secrets if needed for CI
