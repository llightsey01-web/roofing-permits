-- Audit log for admin actions (approve contractor, request changes, etc.)

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_company_id_idx ON audit_log (company_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);

COMMENT ON TABLE audit_log IS 'Admin/operator action audit trail';
