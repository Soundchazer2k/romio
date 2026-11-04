// SPDX-License-Identifier: GPL-3.0
//! BIOS and firmware validation engine.
//!
//! Architecture: hash-first identification, frontend-aware path branching.
//! A BIOS file is identified by its MD5 hash, not its filename.
//! The correct placement path depends on both the emulator and the target frontend.

use anyhow::Result;
use std::path::{Component, Path, PathBuf};
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
    // Key: MD5 hash, Value: every path holding those bytes
    let mut found_files = scan_bios_directory(bios_root)?;

    // Some BIOS files also work outside the BIOS folder (neogeo.zip beside the ROMs),
    // where the scan above never looks. Check those spots directly.
    let scanned_root = normalize_lexically(bios_root);
    for rule in rules {
        for path in accepted_paths(rule, bios_root, frontend, emulator) {
            if !path.starts_with(&scanned_root) && path.is_file() {
                if let Ok(hash) = md5_file(&path) {
                    found_files.entry(hash).or_default().push(path);
                }
            }
        }
    }

    let mut entries: Vec<_> = rules.iter()
        .map(|rule| evaluate_rule(rule, &found_files, bios_root, frontend, emulator))
        .collect();

    // A region's BIOS is only needed for that region's games. Once every required file of
    // one region is valid, the system plays, so other regions' missing files are optional.
    let needed = |r: &BiosRule, e: &BiosEntryResult|
        r.requirement == BiosRequirement::Required && e.state != BiosValidationState::NotApplicable;
    let region_complete = |region: &str| rules.iter().zip(&entries)
        .filter(|(r, e)| needed(r, e) && r.region.as_deref() == Some(region))
        .all(|(_, e)| e.state == BiosValidationState::PresentValid);
    let any_region_complete = rules.iter().zip(&entries)
        .filter(|(r, e)| needed(r, e))
        .filter_map(|(r, _)| r.region.as_deref())
        .any(region_complete);
    if any_region_complete {
        for (rule, entry) in rules.iter().zip(entries.iter_mut()) {
            if rule.region.is_some() && entry.state == BiosValidationState::MissingRequired {
                entry.state = BiosValidationState::MissingOptional;
            }
        }
    }

    // A required file that is missing, corrupt or misplaced won't boot anything.
    let blocking = rules.iter().zip(&entries).any(|(rule, entry)| {
        let usable = entry.state == BiosValidationState::PresentValid
            || entry.state == BiosValidationState::NotApplicable;
        rule.requirement == BiosRequirement::Required
            && !usable
            && !(entry.state == BiosValidationState::PresentHashMismatch && hash_is_inconclusive(rule))
            && !(rule.region.is_some() && any_region_complete)
    });

    let system = rules.first()
        .map(|r| r.system.clone())
        .unwrap_or_default();

    Ok(BiosSystemResult { system, entries, blocking, errored: false })
}

/// A zip's hash changes when it's rebuilt, and a rule with no hash can't judge a file.
fn hash_is_inconclusive(rule: &BiosRule) -> bool {
    rule.compressed || rule.known_good_md5.is_empty()
}

/// Scan a directory tree and build a hash-to-path index.
/// This is the core of hash-first identification.
fn scan_bios_directory(root: &Path) -> Result<HashMap<String, Vec<PathBuf>>> {
    let mut index: HashMap<String, Vec<PathBuf>> = HashMap::new();

    if !root.exists() {
        return Ok(index);
    }

    for entry in WalkDir::new(root)
        .max_depth(4) // reasonable depth limit
        .sort_by_file_name()
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
                Ok(hash) => { index.entry(hash).or_default().push(path.to_path_buf()); }
                Err(_)   => { /* skip unreadable files */ }
            }
        }
    }

    Ok(index)
}

/// Evaluate a single BIOS rule against the scanned file index.
fn evaluate_rule(
    rule: &BiosRule,
    found_files: &HashMap<String, Vec<PathBuf>>,
    bios_root: &Path,
    frontend: &str,
    emulator: &str,
) -> BiosEntryResult {
    if !rule.only_emulators.is_empty() && !rule.only_emulators.iter().any(|e| e == emulator) {
        return BiosEntryResult {
            rule: rule.clone(),
            found_path: None,
            found_md5: None,
            state: BiosValidationState::NotApplicable,
            rename_from: None,
            bad_dump_label: None,
        };
    }

    // Determine where this frontend+emulator combination can read the file from.
    let accepted = accepted_paths(rule, bios_root, frontend, emulator);
    let expected_path = &accepted[0];

    // Every copy of a known-good hash; one in an accepted place wins over any backups.
    let copies: Vec<(&String, &PathBuf)> = rule.known_good_md5.iter()
        .flat_map(|hash| found_files.get(hash).into_iter().flatten().map(move |p| (hash, p)))
        .collect();
    let any_name = rule.any_name_emulators.iter().any(|e| e == emulator);
    let selected = rule.first_existing_emulators.iter().any(|e| e == emulator)
        .then(|| accepted.iter().find(|p| p.is_file()))
        .flatten();
    let is_in_place = |p: &Path| {
        let p = normalize_lexically(p);
        match selected {
            Some(file) => same_path(&p, file),
            None => accepted.iter().any(|a| same_path(&p, a))
                || (any_name && p.parent().zip(expected_path.parent()).is_some_and(|(a, b)| same_path(a, b))),
        }
    };
    let in_place = copies.iter().find(|(_, p)| is_in_place(p));
    let hash_match = in_place.or(copies.first())
        .map(|(hash, path)| ((*hash).clone(), (*path).clone()));

    // Check if any known-bad-dump hash is present, unless a good copy is already in place.
    let bad_dump_match = rule.known_bad_md5.iter()
        .filter(|_| in_place.is_none())
        .find_map(|entry| found_files.get(&entry.md5).map(|_| entry.label.clone()));

    // The emulator will read this file, so a good copy elsewhere doesn't help.
    if let (Some(file), None) = (selected, in_place) {
        return BiosEntryResult {
            rule: rule.clone(),
            found_path: Some(file.to_string_lossy().to_string()),
            found_md5: None,
            state: BiosValidationState::PresentHashMismatch,
            rename_from: None,
            bad_dump_label: bad_dump_match,
        };
    }

    // Files with the rule's name, and whether any is where the emulator reads it.
    let same_name: Vec<&PathBuf> = found_files.values().flatten()
        .filter(|p| p.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_lowercase() == rule.filename.to_lowercase())
            .unwrap_or(false))
        .collect();
    let readable = same_name.iter().find(|p| {
        let p = normalize_lexically(p);
        accepted.iter().any(|a| same_path(&p, a))
    });

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
            let at_correct_path = is_in_place(&actual_path);
            let rename_needed = !at_correct_path && actual_path.file_name() != expected_path.file_name();

            // A recognised copy it can't reach, beside another version it can: judge what it reads.
            if let (false, true, Some(file)) = (at_correct_path, hash_is_inconclusive(rule), readable) {
                return BiosEntryResult {
                    rule: rule.clone(),
                    found_path: Some(file.to_string_lossy().to_string()),
                    found_md5: None,
                    state: BiosValidationState::PresentHashMismatch,
                    rename_from: None,
                    bad_dump_label: None,
                };
            }

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
            let state = if !same_name.is_empty() && readable.is_none() && hash_is_inconclusive(rule) {
                // The hash can't condemn it, but the emulator still can't find it there
                BiosValidationState::PresentWrongPath
            } else if !same_name.is_empty() {
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
        .or_else(|| rule.frontend_paths.get(super::rules_frontend(frontend)))
        .map(String::as_str)
        .unwrap_or(&rule.default_path);

    normalize_lexically(&bios_root.join(path_str).join(&rule.filename))
}

/// Everywhere the file works: the expected path first, then the rule's other folders.
fn accepted_paths(
    rule: &BiosRule,
    bios_root: &Path,
    frontend: &str,
    emulator: &str,
) -> Vec<PathBuf> {
    let mut paths = vec![resolve_expected_path(rule, bios_root, frontend, emulator)];
    paths.extend(rule.also_accepted_paths.iter().map(|place| {
        let file = if place.is_empty() || place.ends_with('/') {
            bios_root.join(place).join(&rule.filename)
        } else {
            bios_root.join(place)
        };
        normalize_lexically(&file)
    }));
    paths
}

/// Whether two paths name the same file, under the host filesystem's case rules.
/// shortcut: assumes the platform default (macOS can be formatted case-sensitive); upgrade if that gets reported.
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Resolve `.` and `..` without touching the disk, so a frontend path that climbs out
/// of the BIOS folder compares equal to the path a file was actually found at.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => { out.pop(); }
            other => out.push(other),
        }
    }
    out
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
            also_accepted_paths: vec![],
            any_name_emulators: vec![],
            first_existing_emulators: vec![],
            only_emulators: vec![],
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
    fn one_complete_region_is_enough_to_play() {
        let dir = TempDir::new().unwrap();
        let us_bytes = b"fake us bios";
        std::fs::write(dir.path().join("us.bin"), us_bytes).unwrap();
        let regional = |file: &str, md5: &str, region: &str| BiosRule {
            region: Some(region.into()),
            ..make_rule(file, md5, BiosRequirement::Required)
        };
        let rules = [
            regional("us.bin", &crate::engine::hash::md5_bytes(us_bytes), "US"),
            regional("jp.bin", "00000000000000000000000000000001", "JP"),
            regional("eu.bin", "00000000000000000000000000000002", "EU"),
        ];

        let result = validate_system_bios(dir.path(), &rules, "esde", "lr-test").unwrap();
        assert!(!result.blocking, "a valid US BIOS plays US games");
        assert_eq!(result.entries[1].state, BiosValidationState::MissingOptional, "JP only needed for JP games");
        assert_eq!(result.entries[2].state, BiosValidationState::MissingOptional);

        // A bad US dump completes no region, so the others stay required
        std::fs::write(dir.path().join("us.bin"), b"bad dump").unwrap();
        let result = validate_system_bios(dir.path(), &rules, "esde", "lr-test").unwrap();
        assert!(result.blocking);
        assert_eq!(result.entries[1].state, BiosValidationState::MissingRequired);
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
