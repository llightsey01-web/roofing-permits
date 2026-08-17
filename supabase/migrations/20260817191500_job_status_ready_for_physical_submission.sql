-- ZIG-8: document new coarse job_status value.
-- Live schema (staging + current repo history): jobs.job_status is TEXT, not a Postgres enum.
-- Therefore there is no ALTER TYPE ... ADD VALUE. The new value is application-enforced:
--   'ready_for_physical_submission'
-- No packet micro-statuses are introduced.
-- This migration records the decision in migration history without schema DDL.

SELECT 'zig8_ready_for_physical_submission_text_status' AS zig8_status_note;
