-- Add per-project indexes for save_checkpoints and operation_log.
-- Both tables were created in 001_initial.sql but lacked these indexes.
CREATE INDEX IF NOT EXISTS idx_save_checkpoints_project ON save_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_project    ON operation_log(project_id);
