// SPDX-License-Identifier: GPL-3.0
//! BIOS and firmware validation engine.
//!
//! Architecture: hash-first identification, frontend-aware path branching.
//! A BIOS file is identified by its MD5 hash, not its filename.
//! The correct placement path depends on both the emulator and the target frontend.

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use walkdir::WalkDir;

use crate::models::artifact::BiosValidationState;
use crate::models::bios::{BiosRule, BiosEntryResult, BiosSystemResult, BiosRequirement};
use crate::engine::hash::md5_file;

/// File extensions that may be BIOS files — scanned during hash-first discovery.
const BIOS_EXTENSIONS: &[&str] = &[
    "bin", "rom", "img", "dat", "pup", "zip", "7z",
    "raf", "ic1", "ic2", "pce", "sms", "gg",
];

/// Validate all BIOS rules for a given system against the bios directory.
///
/// # Arguments
/// * `bios_root`  - The root bios directory for the active frontend
/// * `rules`      - BIOS rules for the system being validated
/// * `frontend`   - The target frontend ID (e.g. "esde", "retrobat", "launchbox")
/// * `emulator`   - The active emulator for this system (e.g. "lr-beetle-saturn", "ymir")
pub fn validate_system_bios(
    bios_root: &Path,
    rules: &[BiosRule],
    frontend: &str,
    emulator: &str,
) -> Result<BiosSystemResult> {
    // Step 1: Build a hash map of all files found in the bios directory tree.
    // Key: MD5 hash, Value: (actual path, filename)
    let found_files = scan_bios_directory(bios_root)?;

    let mut entries = Vec::new();
    let mut blocking = false;

    for rule in rules {
        let entry = evaluate_rule(rule, &found_files, bios_root, frontend, emulator);
        if entry.state == BiosValidationState::MissingRequired {
            if rule.requirement == BiosRequirement::Required {
                blocking = true;
            }
        }
        entries.push(entry);
    }

    let system = rules.first()
        .map(|r| r.system.clone())
        .unwrap_or_default();

    Ok(BiosSystemResult { system, entries, blocking, errored: false })
}

/// Scan a directory tree and build a hash-to-path index.
/// This is the core of hash-first identification.
fn scan_bios_directory(root: &Path) -> Result<HashMap<String, PathBuf>> {
    let mut index: HashMap<String, PathBuf> = HashMap::new();

    if !root.exists() {
        return Ok(index);
    }

    for entry in WalkDir::new(root)
        .max_depth(4) // reasonable depth limit
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if BIOS_EXTENSIONS.contains(&ext.as_str()) {
            match md5_file(path) {
                Ok(hash) => { index.insert(hash, path.to_path_buf()); }
                Err(_)   => { /* skip unreadable files */ }
            }
        }
    }

    Ok(index)
}

/// Evaluate a single BIOS rule against the scanned file index.
fn evaluate_rule(
    rule: &BiosRule,
    found_files: &HashMap<String, PathBuf>,
    bios_root: &Path,
    frontend: &str,
    emulator: &str,
) -> BiosEntryResult {
    // Determine the expected placement path for this frontend+emulator combination.
    let expected_path = resolve_expected_path(rule, bios_root, frontend, emulator);

    // Check if any known-good hash is present anywhere in the scan.
    let hash_match = rule.known_good_md5.iter()
        .find_map(|hash| found_files.get(hash).map(|p| (hash.clone(), p.clone())));

    // Check if any known-bad-dump hash is present.
    let bad_dump_match = rule.known_bad_md5.iter()
        .find_map(|entry| found_files.get(&entry.md5).map(|_| entry.label.clone()));

    match (hash_match, bad_dump_match) {
        // Bad dump detected — highest priority flag
        (_, Some(label)) => BiosEntryResult {
            rule: rule.clone(),
            found_path: None,
            found_md5: None,
            state: BiosValidationState::PresentHashMismatch,
            rename_from: None,
            bad_dump_label: Some(label),
        },

        // Valid hash found — check if it's at the right path
        (Some((hash, actual_path)), None) => {
            let at_correct_path = actual_path.starts_with(&expected_path);
            let rename_needed = actual_path.file_name() != expected_path.file_name();

            BiosEntryResult {
                rule: rule.clone(),
                found_path: Some(actual_path.to_string_lossy().to_string()),
                found_md5: Some(hash),
                state: if at_correct_path {
                    BiosValidationState::PresentValid
                } else {
                    BiosValidationState::PresentWrongPath
                },
                rename_from: if rename_needed {
                    actual_path.file_name()
                        .and_then(|n| n.to_str())
                        .map(String::from)
                } else {
                    None
                },
                bad_dump_label: None,
            }
        }

        // No valid hash found anywhere
        (None, None) => {
            // Check if the filename exists but with wrong hash (possible corruption)
            let filename_exists_wrong_hash = found_files.values()
                .any(|p| p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.to_lowercase() == rule.filename.to_lowercase())
                    .unwrap_or(false));

            let state = if filename_exists_wrong_hash {
                BiosValidationState::PresentHashMismatch
            } else {
                match rule.requirement {
                    BiosRequirement::Required     => BiosValidationState::MissingRequired,
                    BiosRequirement::Optional
                    | BiosRequirement::KeysCrypto => BiosValidationState::MissingOptional,
                    BiosRequirement::NotRequired  => BiosValidationState::NotApplicable,
                }
            };

            BiosEntryResult {
                rule: rule.clone(),
                found_path: None,
                found_md5: None,
                state,
                rename_from: None,
                bad_dump_label: None,
            }
        }
    }
}

/// Resolve the expected placement path for a BIOS rule given frontend and emulator context.
///
/// Priority: emulator-specific path > frontend-specific path > default path
fn resolve_expected_path(
    rule: &BiosRule,
    bios_root: &Path,
    frontend: &str,
    emulator: &str,
) -> PathBuf {
    let path_str = rule.emulator_paths.get(emulator)
        .or_else(|| rule.frontend_paths.get(frontend))
        .map(String::as_str)
        .unwrap_or(&rule.default_path);

    bios_root.join(path_str).join(&rule.filename)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;
    use crate::models::bios::BadDumpEntry;

    fn make_rule(filename: &str, md5: &str, requirement: BiosRequirement) -> BiosRule {
        BiosRule {
            filename: filename.to_string(),
            known_good_md5: vec![md5.to_string()],
            known_bad_md5: vec![],
            system: "test_system".to_string(),
            region: None,
            requirement,
            compressed: false,
            default_path: "".to_string(),
            frontend_paths: HashMap::new(),
            emulator_paths: HashMap::new(),
            notes: None,
            dumping_guide_url: None,
        }
    }

    #[test]
    fn test_missing_required_bios() {
        let dir = TempDir::new().unwrap();
        let rule = make_rule("test.bin", "deadbeef00000000deadbeef00000000", BiosRequirement::Required);
        let result = validate_system_bios(dir.path(), &[rule], "esde", "lr-test").unwrap();
        assert!(result.blocking);
        assert_eq!(result.entries[0].state, BiosValidationState::MissingRequired);
    }

    #[test]
    fn test_present_valid_bios() {
        let dir = TempDir::new().unwrap();
        let data = b"fake bios content";
        let hash = crate::engine::hash::md5_bytes(data);
        let bios_path = dir.path().join("test.bin");
        std::fs::write(&bios_path, data).unwrap();

        let rule = make_rule("test.bin", &hash, BiosRequirement::Required);
        let result = validate_system_bios(dir.path(), &[rule], "esde", "lr-test").unwrap();
        assert!(!result.blocking);
        assert_eq!(result.entries[0].state, BiosValidationState::PresentValid);
    }

    #[test]
    fn test_known_bad_dump_detected() {
        let dir = TempDir::new().unwrap();
        let data = b"bad dump data";
        let bad_hash = crate::engine::hash::md5_bytes(data);
        let bios_path = dir.path().join("mcpx_1.0.bin");
        std::fs::write(&bios_path, data).unwrap();

        let mut rule = make_rule("mcpx_1.0.bin", "d49c52a4102f6df7bcf8d0617ac475ed", BiosRequirement::Required);
        rule.known_bad_md5 = vec![BadDumpEntry {
            md5: bad_hash,
            label: "MCPX bad dump — off by a few bytes".to_string(),
        }];

        let result = validate_system_bios(dir.path(), &[rule], "esde", "xemu").unwrap();
        assert_eq!(result.entries[0].state, BiosValidationState::PresentHashMismatch);
        assert!(result.entries[0].bad_dump_label.is_some());
    }
}
