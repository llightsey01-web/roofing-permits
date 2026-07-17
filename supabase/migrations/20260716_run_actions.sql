-- Per-step automation audit trail (run manually in Supabase if not already applied)

CREATE TABLE IF NOT EXISTS run_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid REFERENCES automation_runs(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  action text NOT NULL,
  status text NOT NULL,
  step_number int,
  step_name text,
  portal_response text,
  screenshot_path text,
  file_path text,
  error_message text,
  duration_ms int,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_actions_run_id_idx ON run_actions (run_id);
CREATE INDEX IF NOT EXISTS run_actions_job_id_idx ON run_actions (job_id);
CREATE INDEX IF NOT EXISTS run_actions_created_at_idx ON run_actions (created_at DESC);

-- Allow super_admin to read audit trail in admin UI (service role already bypasses RLS)
ALTER TABLE run_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_actions_super_admin_select ON run_actions;
CREATE POLICY run_actions_super_admin_select ON run_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'super_admin'
    )
  );
