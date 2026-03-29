-- Add persisted scan_stats JSON to projects.
-- SPDX-License-Identifier: GPL-3.0

ALTER TABLE projects ADD COLUMN IF NOT EXISTS scan_stats TEXT;
