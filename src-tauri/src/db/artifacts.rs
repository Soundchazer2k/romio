// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::artifact::Artifact;

/// Replace all artifacts for a project with a fresh batch from the latest scan.
/// Called at the end of `scan_library` after the scan completes successfully.
pub fn save_batch(project_id: &str, artifacts: &[Artifact]) -> Result<()> {
    crate::db::with_conn(|conn| {
        // Delete stale artifacts before inserting fresh ones
        conn.execute(
            "DELETE FROM artifacts WHERE project_id = ?1",
            rusqlite::params![project_id],
        )?;

        for artifact in artifacts {
            conn.execute(
                "INSERT INTO artifacts (
                    id, project_id, artifact_type,
                    source_path, normalized_path,
                    md5_hash, file_size,
                    detected_system, detected_format,
                    bios_state, format_state,
                    frontend_tags, scan_visibility,
                    title_id, export_status,
                    validation_findings, save_root_assoc,
                    notes, scanned_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
                )",
                rusqlite::params![
                    artifact.id.to_string(),
                    project_id,
                    serde_json::to_string(&artifact.artifact_type)
                        .unwrap_or_default(),
                    artifact.source_path,
                    artifact.normalized_path,
                    artifact.md5_hash,
                    artifact.file_size.map(|s| s as i64),
                    artifact.detected_system,
                    artifact.detected_format,
                    serde_json::to_string(&artifact.bios_state)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.format_state)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.frontend_tags)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.scan_visibility)
                        .unwrap_or_default(),
                    artifact.title_id,
                    serde_json::to_string(&artifact.export_status)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.validation_findings)
                        .unwrap_or_default(),
                    artifact.save_root_association.as_ref()
                        .and_then(|s| serde_json::to_string(s).ok()),
                    artifact.notes,
                    artifact.scanned_at.to_rfc3339(),
                ],
            )?;
        }
        Ok(())
    })
}
