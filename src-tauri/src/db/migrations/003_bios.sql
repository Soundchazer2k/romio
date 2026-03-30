-- Add BIOS status persistence columns to projects.
-- SPDX-License-Identifier: GPL-3.0

ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_root              TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_results           TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bios_last_validated_at TEXT;
