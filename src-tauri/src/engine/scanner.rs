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
