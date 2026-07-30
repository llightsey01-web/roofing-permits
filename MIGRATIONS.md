# Migration Policy

All schema changes are files in `supabase/migrations/`, using unique timestamp prefixes (never reuse a date — if multiple migrations land the same day, use `YYYYMMDDNNNN` sequencing, not `YYYYMMDD` alone — a duplicate-timestamp bug caused a real migration-tracking outage on 2026-07-30).

- Agents may freely write and apply migrations against **staging** (`trimwcwzimfgzgimfwby`) for testing.
- Agents must **never** run `supabase db push`, `supabase migration repair`, `supabase db reset`, or any raw SQL against **production** (`yhxzwjoouiurxrmhjslg`) without Logan's explicit review and go-ahead.
- Before assuming a migration needs to run, always check `supabase migration list` first — schema may already be live even if the CLI's tracking history doesn't show it (this happened historically before migration tracking was reconciled on 2026-07-30).
- Production migrations are applied only by Logan, after reviewing the file — via `supabase db push --linked`, run manually.
