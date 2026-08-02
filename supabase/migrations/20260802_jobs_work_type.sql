-- Portal Work Type for contractor intake (New, Repair, Addition, Alteration)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_type text;

COMMENT ON COLUMN jobs.work_type IS 'Accela portal Work Type — New, Repair, Addition, or Alteration';
