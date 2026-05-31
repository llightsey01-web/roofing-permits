-- Migration: secure AHJ credential storage
-- Run in Supabase SQL editor

-- Add encrypted password column and notes (if not present)
ALTER TABLE company_ahj_credentials
  ADD COLUMN IF NOT EXISTS password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Optional: migrate existing plaintext passwords to encrypted storage
-- Run via a one-time server script using secureCredentialService after setting CREDENTIAL_ENCRYPTION_KEY
-- Do NOT expose portal_password in client queries after migration

-- Recommended: unique credential per company + AHJ
CREATE UNIQUE INDEX IF NOT EXISTS company_ahj_credentials_company_ahj_unique
  ON company_ahj_credentials (company_id, ahj_id);

COMMENT ON COLUMN company_ahj_credentials.password_encrypted IS 'AES-256-GCM encrypted password; server-side decrypt only';
COMMENT ON COLUMN company_ahj_credentials.portal_password IS 'Legacy plaintext column; deprecated — use password_encrypted';
