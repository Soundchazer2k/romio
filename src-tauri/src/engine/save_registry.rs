// SPDX-License-Identifier: GPL-3.0
//! Save-path migration registry.
//! Detects save roots at risk and generates migration plans.

use anyhow::Result;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::models::save::{
    SavePathRule, SaveRoot, SaveMigrationState,
    MigrationPlan, MigrationStep, MigrationAction, SaveCheckpoint,
};
use crate::engine::path_normalizer::{is_symlink, resolve_symlink};

/// Discover save roots for all known emulators relative to a frontend root.
pub fn discover_save_roots(
    frontend_root: &Path,
    rules: &[SavePathRule],
) -> Vec<SaveRoot> {
    let mut roots = Vec::new();

    for rule in rules {
        let old_path = frontend_root.join(&rule.old_path_pattern);
        let new_path = frontend_root.join(&rule.new_path_pattern);

        let old_exists = old_path.exists();
        let new_exists = new_path.exists();

        let migration_state = match (old_exists, new_exists) {
            (true,  false) => SaveMigrationState::MigrationNeeded,
            (true,  true)  => SaveMigrationState::ConflictDetected,
            (false, true)  => SaveMigrationState::AlreadyMigrated,
            (false, false) => SaveMigrationState::NotApplicable,
        };

        // Only report roots that exist or are at risk
        if old_exists || new_exists {
            let (active_path, stats) = if new_exists {
                (new_path.clone(), count_files_and_size(&new_path))
            } else {
                (old_path.clone(), count_files_and_size(&old_path))
            };

            let symlink = is_symlink(&active_path);
            let real = if symlink { resolve_symlink(&active_path) } else { None };

            roots.push(SaveRoot {
                path: active_path.to_string_lossy().to_string(),
                emulator: rule.emulator.clone(),
                is_symlink: symlink,
                real_path: real.map(|p| p.to_string_lossy().to_string()),
                file_count: stats.0,
                size_bytes: stats.1,
                migration_state,
            });
        }
    }

    roots
}

/// Build a migration plan for a specific save root.
/// This plan must be presented to and confirmed by the user before execution.
pub fn build_migration_plan(
    source: &Path,
    destination: &Path,
    emulator: &str,
) -> Result<MigrationPlan> {
    let (file_count, size_bytes) = count_files_and_size(source);
    let symlink_warning = if is_symlink(source) {
        Some(format!(
            "{} is a symlink. Moving files may change the symlink target rather than the actual files. Review carefully before proceeding.",
            source.display()
        ))
    } else {
        None
    };

    let steps = vec![
        MigrationStep {
            order: 1,
            action: MigrationAction::CreateCheckpoint,
            description: format!(
                "Create backup archive of {} ({} files, {:.1} MB)",
                source.display(),
                file_count,
                size_bytes as f64 / 1_048_576.0
            ),
            reversible: false,
        },
        MigrationStep {
            order: 2,
            action: MigrationAction::CopyFiles,
            description: format!(
                "Copy {} → {}",
                source.display(),
                destination.display()
            ),
            reversible: true,
        },
        MigrationStep {
            order: 3,
            action: MigrationAction::VerifyDestination,
            description: "Verify all files copied correctly (file count and size check)".to_string(),
            reversible: false,
        },
    ];

    Ok(MigrationPlan {
        source_path:      source.to_string_lossy().to_string(),
        destination_path: destination.to_string_lossy().to_string(),
        file_count,
        size_bytes,
        emulator: emulator.to_string(),
        requires_backup: true,
        symlink_warning,
        steps,
    })
}

fn count_files_and_size(path: &Path) -> (u64, u64) {
    if !path.exists() { return (0, 0); }
    let mut count = 0u64;
    let mut size  = 0u64;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            count += 1;
            size  += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (count, size)
}
