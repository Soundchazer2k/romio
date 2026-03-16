-- Romio initial schema
-- SPDX-License-Identifier: GPL-3.0

CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    library_roots   TEXT NOT NULL,  -- JSON array
    target_frontends TEXT NOT NULL, -- JSON array
    emulator_prefs  TEXT NOT NULL,  -- JSON object
    created_at      TEXT NOT NULL,
    last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    artifact_type       TEXT NOT NULL,
    source_path         TEXT NOT NULL,
    normalized_path     TEXT NOT NULL,
    md5_hash            TEXT,
    file_size           INTEGER,
    detected_system     TEXT,
    detected_format     TEXT,
    bios_state          TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    format_state        TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    frontend_tags       TEXT NOT NULL DEFAULT '[]', -- JSON array
    scan_visibility     TEXT NOT NULL DEFAULT 'visible',
    title_id            TEXT,
    export_status       TEXT NOT NULL DEFAULT 'not_exported',
    validation_findings TEXT NOT NULL DEFAULT '[]', -- JSON array
    save_root_assoc     TEXT,  -- JSON object or NULL
    notes               TEXT,
    scanned_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project    ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_system     ON artifacts(detected_system);
CREATE INDEX IF NOT EXISTS idx_artifacts_bios_state ON artifacts(bios_state);
CREATE INDEX IF NOT EXISTS idx_artifacts_md5        ON artifacts(md5_hash);

CREATE TABLE IF NOT EXISTS operation_log (
    id              TEXT PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
    operation       TEXT NOT NULL,
    description     TEXT NOT NULL,
    affected_paths  TEXT NOT NULL DEFAULT '[]', -- JSON array
    reversible      INTEGER NOT NULL DEFAULT 0,
    rolled_back     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS save_checkpoints (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
    emulator     TEXT NOT NULL,
    source_path  TEXT NOT NULL,
    archive_path TEXT NOT NULL,
    file_count   INTEGER NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_at   TEXT NOT NULL
);
