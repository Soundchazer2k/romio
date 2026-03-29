// SPDX-License-Identifier: GPL-3.0
//! Library scan engine.
//! Traverses library roots, fingerprints files, and classifies artifacts.

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use walkdir::WalkDir;
use serde::{Deserialize, Serialize};

use crate::models::artifact::{Artifact, ArtifactType};

/// Progress update sent to the frontend during a scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files_scanned:  u64,
    pub files_total:    Option<u64>,
    pub current_path:   String,
    pub phase:          ScanPhase,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanPhase {
    Enumerating,
    Hashing,
    Classifying,
    Complete,
}

/// Extensions that are ROM/image files (not BIOS, not metadata)
const ROM_EXTENSIONS: &[&str] = &[
    "zip", "7z", "rar",
    "iso", "bin", "cue", "img", "chd",
    "rvz", "gcz", "wbfs", "wad", "wua", "wux", "wud",
    "nsp", "xci", "nca",
    "xiso",
    "pbp",
    "nds", "3ds", "cci", "cia", "cxi",
    "gba", "gbc", "gb",
    "sfc", "smc",
    "n64", "z64", "v64",
    "nes", "fds",
    "md", "gen", "smd",
    "gg", "sms", "sg",
    "pce", "sgx",
    "ws", "wsc",
    "ngp", "ngc",
    "lnx",
    "a26", "a78",
    "j64", "jag",
    "hypseus", "daphne",  // daphne flagged as deprecated
    "m3u",
    "ccd", "sub",
    "gdi",
    "cso",
    "adf", "hdf", "lha",
    "d64", "t64", "prg", "tap", "crt",
    "dsk", "st",
    "rom", "mx1", "mx2",
    "p8", "png",  // pico-8
];

/// Scan a set of library roots and return classified artifacts.
///
/// The `cancel` flag allows the scan to be interrupted by the user.
pub fn scan_roots(
    roots: &[PathBuf],
    cancel: Arc<AtomicBool>,
    on_progress: impl Fn(ScanProgress),
) -> Result<Vec<Artifact>> {
    let mut artifacts = Vec::new();
    let mut files_scanned = 0u64;

    for root in roots {
        if cancel.load(Ordering::Relaxed) { break; }

        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if cancel.load(Ordering::Relaxed) { break; }

            let path = entry.path();

            on_progress(ScanProgress {
                files_scanned,
                files_total: None,
                current_path: path.to_string_lossy().to_string(),
                phase: ScanPhase::Classifying,
            });

            if entry.file_type().is_file() {
                files_scanned += 1;
                if let Some(artifact) = classify_file(path) {
                    artifacts.push(artifact);
                }
            }
        }
    }

    on_progress(ScanProgress {
        files_scanned,
        files_total: Some(files_scanned),
        current_path: String::new(),
        phase: ScanPhase::Complete,
    });

    Ok(artifacts)
}

/// Classify a single file into an ArtifactType based on extension and path context.
fn classify_file(path: &Path) -> Option<Artifact> {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext.is_empty() { return None; }

    let artifact_type = if ext == "m3u" {
        ArtifactType::M3u
    } else if ext == "daphne" {
        // Deprecated LaserDisc extension — flag in format validation
        ArtifactType::Rom
    } else if ROM_EXTENSIONS.contains(&ext.as_str()) {
        ArtifactType::Rom
    } else {
        ArtifactType::Unknown
    };

    let file_size = path.metadata().ok().map(|m| m.len());

    Some(Artifact {
        id:                   uuid::Uuid::new_v4(),
        artifact_type,
        source_path:          path.to_string_lossy().to_string(),
        normalized_path:      dunce::canonicalize(path)
                                .unwrap_or(path.to_path_buf())
                                .to_string_lossy()
                                .to_string(),
        md5_hash:             None, // computed lazily during BIOS validation
        file_size,
        detected_system:      None,
        detected_format:      Some(ext),
        bios_state:           Default::default(),
        format_state:         Default::default(),
        frontend_tags:        Vec::new(),
        scan_visibility:      Default::default(),
        title_id:             None,
        export_status:        Default::default(),
        validation_findings:  Vec::new(),
        save_root_association: None,
        notes:                None,
        scanned_at:           chrono::Utc::now(),
    })
}

/// Derive project-level stats from a completed scan's artifact list.
pub fn derive_scan_stats(artifacts: &[crate::models::artifact::Artifact]) -> crate::models::project::ScanStats {
    use crate::models::artifact::{ArtifactType, FindingSeverity};

    let total_files      = artifacts.len() as u64;
    let classified       = artifacts.iter()
        .filter(|a| a.artifact_type != ArtifactType::Unknown)
        .count() as u64;

    let mut blocking_issues = 0u32;
    let mut errors          = 0u32;
    let mut warnings        = 0u32;
    let mut advisories      = 0u32;

    for artifact in artifacts {
        for finding in &artifact.validation_findings {
            match finding.severity {
                FindingSeverity::Blocking => blocking_issues += 1,
                FindingSeverity::Error    => errors += 1,
                FindingSeverity::Warning  => warnings += 1,
                FindingSeverity::Advisory => advisories += 1,
                FindingSeverity::Info     => {}
            }
        }
    }

    crate::models::project::ScanStats {
        total_files,
        classified,
        blocking_issues,
        errors,
        warnings,
        advisories,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::artifact::{
        Artifact, ArtifactType, BiosValidationState, FormatCompatibilityState,
        ScanVisibility, ExportStatus, FindingSeverity, ValidationFinding,
    };

    fn stub_artifact(artifact_type: ArtifactType) -> Artifact {
        Artifact {
            id:                    uuid::Uuid::new_v4(),
            artifact_type,
            source_path:           "/test/file.zip".into(),
            normalized_path:       "/test/file.zip".into(),
            md5_hash:              None,
            file_size:             Some(1024),
            detected_system:       None,
            detected_format:       Some("zip".into()),
            bios_state:            BiosValidationState::NotApplicable,
            format_state:          FormatCompatibilityState::NotApplicable,
            frontend_tags:         vec![],
            scan_visibility:       ScanVisibility::Visible,
            title_id:              None,
            export_status:         ExportStatus::NotExported,
            validation_findings:   vec![],
            save_root_association: None,
            notes:                 None,
            scanned_at:            chrono::Utc::now(),
        }
    }

    #[test]
    fn test_derive_stats_empty() {
        let stats = derive_scan_stats(&[]);
        assert_eq!(stats.total_files, 0);
        assert_eq!(stats.classified, 0);
        assert_eq!(stats.blocking_issues, 0);
    }

    #[test]
    fn test_derive_stats_counts_classified() {
        let artifacts = vec![
            stub_artifact(ArtifactType::Rom),
            stub_artifact(ArtifactType::Unknown),
            stub_artifact(ArtifactType::Bios),
        ];
        let stats = derive_scan_stats(&artifacts);
        assert_eq!(stats.total_files, 3);
        assert_eq!(stats.classified, 2);  // Unknown is not classified
    }

    #[test]
    fn test_derive_stats_aggregates_findings() {
        let mut artifact = stub_artifact(ArtifactType::Rom);
        artifact.validation_findings = vec![
            ValidationFinding {
                severity:           FindingSeverity::Blocking,
                issue_type:         "test".into(),
                description:        "blocking issue".into(),
                recommended_action: None,
                auto_fixable:       false,
            },
            ValidationFinding {
                severity:           FindingSeverity::Warning,
                issue_type:         "test".into(),
                description:        "warning".into(),
                recommended_action: None,
                auto_fixable:       false,
            },
        ];
        let stats = derive_scan_stats(&[artifact]);
        assert_eq!(stats.blocking_issues, 1);
        assert_eq!(stats.warnings, 1);
        assert_eq!(stats.errors, 0);
    }
}
