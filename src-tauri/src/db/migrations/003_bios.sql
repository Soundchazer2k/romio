-- Add BIOS status persistence columns to projects.
-- SPDX-License-Identifier: GPL-3.0

ALTER TABLE projects ADD COLUMN bios_root              TEXT;
ALTER TABLE projects ADD COLUMN bios_results           TEXT;
ALTER TABLE projects ADD COLUMN bios_last_validated_at TEXT;
