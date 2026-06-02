-- company_credentials vault table (Phase 2 credential architecture)

CREATE TABLE IF NOT EXISTS company_credentials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL,
  ahj_id uuid REFERENCES ahj_portals(id) ON DELETE SET NULL,
  credential_type text NOT NULL DEFAULT 'portal',
  encrypted_username text,
  encrypted_password text,
  encrypted_extra jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE(company_id, provider, ahj_id)
);

COMMENT ON COLUMN company_credentials.provider IS 'polk_accela | lee_accela | epn | proof | twocaptcha';
COMMENT ON COLUMN company_credentials.credential_type IS 'ahj_portal | proof | erecord | api_key';

CREATE INDEX IF NOT EXISTS company_credentials_company_provider_idx
  ON company_credentials (company_id, provider)
  WHERE is_active = true;

ALTER TABLE company_credentials ENABLE ROW LEVEL SECURITY;
