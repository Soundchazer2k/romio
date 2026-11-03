// SPDX-License-Identifier: GPL-3.0
//! Save-path migration registry.
//! Detects save roots at risk and generates migration plans.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::models::save::{
    SavePathRule, SaveRoot, SaveMigrationState,
    MigrationPlan, MigrationStep, MigrationAction, SaveCheckpoint,
};
use crate::engine::path_normalizer::{is_symlink, resolve_symlink};

/// Discover save roots for all known emulators, relative to the frontend root
/// or, for rules anchored to "appdata", the user's %APPDATA% folder.
pub fn discover_save_roots(
    frontend_root: &Path,
    appdata: Option<&Path>,
    rules: &[SavePathRule],
) -> Vec<SaveRoot> {
    let mut roots = Vec::new();

    for rule in rules {
        let base = match rule.anchor.as_deref() {
            // An empty root would resolve against the working directory
            None if frontend_root.as_os_str().is_empty() => continue,
            None => frontend_root,
            Some("appdata") => match appdata {
                Some(dir) => dir,
                None => continue,
            },
            Some(_) => continue,
        };
        let old_path = join_pattern(base, &rule.old_path_pattern);
        let new_path = join_pattern(base, &rule.new_path_pattern);

        let old_probe = probe(&old_path);
        let new_probe = probe(&new_path);
        let old_exists = old_probe != Probe::Missing;
        let new_exists = new_probe != Probe::Missing;
        let migration_state = migration_state(old_probe, new_probe);

        // Only report roots that exist or are at risk
        if old_exists || new_exists {
            // Point at the saves still to move (or the folder we can't read); only an
            // already-migrated root points at the destination
            let on_new_side = !old_exists || (new_probe == Probe::Unreadable && old_probe != Probe::Unreadable);
            let active_path = if on_new_side {
                new_path.clone()
            } else {
                old_path.clone()
            };
            // A root we can open but not fully walk would report short totals; treat it as unreadable
            let (migration_state, stats) = match migration_state {
                SaveMigrationState::Unreadable => (SaveMigrationState::Unreadable, (0, 0)),
                state => match try_count_files_and_size(&active_path) {
                    Ok(stats) => (state, stats),
                    Err(_) => (SaveMigrationState::Unreadable, (0, 0)),
                },
            };

            let symlink = is_symlink(&active_path);
            let real = if symlink { resolve_symlink(&active_path) } else { None };

            // Source-side rows point at where their saves are heading; destination rows don't
            let expected_destination = (!on_new_side).then(|| new_path.to_string_lossy().to_string());
            let root = SaveRoot {
                path:                 active_path.to_string_lossy().to_string(),
                emulator:             rule.emulator.clone(),
                is_symlink:           symlink,
                real_path:            real.map(|p| p.to_string_lossy().to_string()),
                file_count:           stats.0,
                size_bytes:           stats.1,
                migration_state,
                expected_destination,
                // Rule notes explain a pending move; they don't apply once only the destination exists
                notes:                if old_exists { rule.notes.clone() } else { None },
            };
            // Rules can share a destination (Citra and Lime3DS both move to Azahar). Report a
            // bare destination row (migrated or unreadable) only once, and only when no rule
            // still has saves heading there.
            let dest = new_path.to_string_lossy().to_string();
            if on_new_side {
                let covered = roots.iter().any(|r: &SaveRoot| {
                    r.path == dest || r.expected_destination.as_deref() == Some(dest.as_str())
                });
                if !covered { roots.push(root); }
            } else {
                roots.retain(|r| !(r.expected_destination.is_none() && r.path == dest));
                roots.push(root);
            }
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
    let (file_count, size_bytes) = try_count_files_and_size(source)
        .with_context(|| format!("can't read every file under {}", source.display()))?;
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

#[derive(Debug, Clone, Copy, PartialEq)]
enum Probe { Missing, Present, Unreadable }

/// A folder we can't stat or list is reported as unreadable, never as missing:
/// calling it missing could suggest moving saves on top of it.
fn probe(path: &Path) -> Probe {
    match path.try_exists() {
        Ok(false) => Probe::Missing,
        Err(_) => Probe::Unreadable,
        Ok(true) if path.is_dir() && std::fs::read_dir(path).is_err() => Probe::Unreadable,
        Ok(true) => Probe::Present,
    }
}

fn migration_state(old: Probe, new: Probe) -> SaveMigrationState {
    match (old, new) {
        (Probe::Unreadable, _) | (_, Probe::Unreadable) => SaveMigrationState::Unreadable,
        (Probe::Present, Probe::Missing) => SaveMigrationState::MigrationNeeded,
        (Probe::Present, Probe::Present) => SaveMigrationState::ConflictDetected,
        (Probe::Missing, Probe::Present) => SaveMigrationState::AlreadyMigrated,
        (Probe::Missing, Probe::Missing) => SaveMigrationState::NotApplicable,
    }
}

/// Join a "/"-separated rule pattern so the result uses the platform's separator throughout.
fn join_pattern(base: &Path, pattern: &str) -> PathBuf {
    pattern.split('/').filter(|c| !c.is_empty()).fold(base.to_path_buf(), |p, c| p.join(c))
}

/// Count files and bytes under `path`, failing if any entry can't be read, so a
/// partly readable root never reports short totals as if they were complete.
fn try_count_files_and_size(path: &Path) -> Result<(u64, u64)> {
    let mut count = 0u64;
    let mut size  = 0u64;
    for entry in WalkDir::new(path) {
        let entry = entry?;
        if entry.file_type().is_file() {
            count += 1;
            size  += entry.metadata()?.len();
        }
    }
    Ok((count, size))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(anchor: Option<&str>) -> SavePathRule {
        SavePathRule {
            emulator: "eden".into(),
            frontend: None,
            anchor: anchor.map(Into::into),
            version_from: None,
            version_to: None,
            old_path_pattern: "yuzu/nand/user/save".into(),
            new_path_pattern: "eden/nand/user/save".into(),
            trigger: String::new(),
            notes: None,
        }
    }

    #[test]
    fn appdata_rules_resolve_under_appdata_not_frontend_root() {
        let frontend = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(appdata.path().join("yuzu/nand/user/save")).unwrap();
        std::fs::write(appdata.path().join("yuzu/nand/user/save/a.bin"), b"save").unwrap();

        let roots = discover_save_roots(frontend.path(), Some(appdata.path()), &[rule(Some("appdata"))]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].migration_state, SaveMigrationState::MigrationNeeded);
        assert_eq!(roots[0].file_count, 1);
        assert_eq!(
            roots[0].expected_destination.as_deref(),
            Some(join_pattern(appdata.path(), "eden/nand/user/save").to_string_lossy().as_ref())
        );

        // Same layout under the frontend root is ignored for an appdata rule
        let roots = discover_save_roots(appdata.path(), Some(frontend.path()), &[rule(Some("appdata"))]);
        assert!(roots.is_empty());
    }

    #[test]
    fn appdata_rules_skipped_without_appdata_or_with_unknown_anchor() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("yuzu/nand/user/save")).unwrap();

        assert!(discover_save_roots(dir.path(), None, &[rule(Some("appdata"))]).is_empty());
        assert!(discover_save_roots(dir.path(), Some(dir.path()), &[rule(Some("home"))]).is_empty());
        assert_eq!(discover_save_roots(dir.path(), None, &[rule(None)]).len(), 1);
        // Frontend-root rules need a frontend root
        assert!(discover_save_roots(Path::new(""), None, &[rule(None)]).is_empty());
    }

    #[test]
    fn unreadable_on_either_side_wins_over_every_other_state() {
        use Probe::*;
        for other in [Missing, Present, Unreadable] {
            assert_eq!(migration_state(Unreadable, other), SaveMigrationState::Unreadable);
            assert_eq!(migration_state(other, Unreadable), SaveMigrationState::Unreadable);
        }
        assert_eq!(migration_state(Present, Missing), SaveMigrationState::MigrationNeeded);
        assert_eq!(migration_state(Missing, Missing), SaveMigrationState::NotApplicable);
    }

    #[test]
    fn readable_folders_probe_as_present_and_absent_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(probe(dir.path()), Probe::Present);
        assert_eq!(probe(&dir.path().join("nope")), Probe::Missing);
    }

    #[test]
    fn counting_fails_on_a_missing_root_instead_of_reporting_zero() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.sav"), b"12345").unwrap();
        assert_eq!(try_count_files_and_size(dir.path()).unwrap(), (1, 5));
        assert!(try_count_files_and_size(&dir.path().join("gone")).is_err());
    }

    #[test]
    fn shared_destination_reported_once_with_source_rule_winning() {
        let appdata = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(appdata.path().join("Lime3DS/sdmc")).unwrap();
        std::fs::create_dir_all(appdata.path().join("Azahar/sdmc")).unwrap();
        let shared = |old: &str| SavePathRule {
            old_path_pattern: old.into(),
            new_path_pattern: "Azahar/sdmc".into(),
            notes: Some("move note".into()),
            ..rule(Some("appdata"))
        };
        // Citra first: its source is missing, so alone it would say AlreadyMigrated
        let rules = [shared("Citra/sdmc"), shared("Lime3DS/sdmc")];

        let roots = discover_save_roots(Path::new(""), Some(appdata.path()), &rules);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].migration_state, SaveMigrationState::ConflictDetected);
        assert_eq!(roots[0].path, appdata.path().join("Lime3DS").join("sdmc").to_string_lossy());
        assert!(roots[0].notes.is_some());

        // Neither source: one bare AlreadyMigrated row, no move notes
        std::fs::remove_dir_all(appdata.path().join("Lime3DS")).unwrap();
        let roots = discover_save_roots(Path::new(""), Some(appdata.path()), &rules);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].migration_state, SaveMigrationState::AlreadyMigrated);
        assert!(roots[0].notes.is_none());
    }
}
