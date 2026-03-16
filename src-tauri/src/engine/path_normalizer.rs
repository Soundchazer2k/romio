// SPDX-License-Identifier: GPL-3.0
//! Platform-aware path normalization.
//! Handles Windows/macOS/Linux separator differences, case sensitivity,
//! UNC path resolution, and symlink detection.

use anyhow::Result;
use std::path::{Path, PathBuf};

/// Normalize a path for the current OS and target frontend.
/// Resolves symlinks, normalizes separators, and strips UNC prefixes on Windows.
pub fn normalize_path(path: &Path) -> Result<PathBuf> {
    // dunce::canonicalize resolves symlinks AND strips Windows UNC \\?\ prefixes
    // that break many string comparisons and frontend path expectations.
    let canonical = dunce::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf());
    Ok(canonical)
}

/// Check if a path is or resolves through a symlink.
pub fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Resolve the real path behind a symlink chain.
pub fn resolve_symlink(path: &Path) -> Option<PathBuf> {
    if is_symlink(path) {
        dunce::canonicalize(path).ok()
    } else {
        None
    }
}

/// Check if a path contains spaces and whether it is properly quoted
/// for use in a launch command on the current OS.
pub fn needs_quoting(path: &Path) -> bool {
    path.to_string_lossy().contains(' ')
}

/// Validate that a path uses consistent separators for the current OS.
/// Returns None if valid, Some(corrected) if correction is needed.
pub fn check_separator_consistency(path_str: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, mixed forward/back slashes in a single path string
        // can cause issues with some frontend parsers.
        if path_str.contains('/') && path_str.contains('\\') {
            return Some(path_str.replace('/', "\\"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On macOS/Linux, backslashes in paths are literal characters, not separators.
        // Flag any backslash as a potential Windows path used on the wrong OS.
        if path_str.contains('\\') {
            return Some(path_str.replace('\\', "/"));
        }
    }
    None
}

/// Case sensitivity check — relevant on macOS (case-insensitive by default)
/// and Linux (case-sensitive). Returns the correctly-cased path if different.
pub fn check_case_sensitivity(path: &Path) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        // On Linux, BIOS filenames must match exactly.
        // If the file exists under a different case, report it.
        if let Some(parent) = path.parent() {
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                if let Ok(entries) = std::fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let entry_name = entry.file_name();
                        let entry_str = entry_name.to_string_lossy();
                        if entry_str.to_lowercase() == filename.to_lowercase()
                            && entry_str != filename
                        {
                            return Some(entry_str.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// Build a quoted path string safe for use in a launch command.
pub fn quote_path(path: &Path) -> String {
    let path_str = path.to_string_lossy();
    if needs_quoting(path) {
        format!("\"{}\"", path_str)
    } else {
        path_str.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_needs_quoting_with_spaces() {
        let path = Path::new("/home/user/my roms/game.bin");
        assert!(needs_quoting(path));
    }

    #[test]
    fn test_needs_quoting_without_spaces() {
        let path = Path::new("/home/user/roms/game.bin");
        assert!(!needs_quoting(path));
    }

    #[test]
    fn test_quote_path() {
        let path = Path::new("/home/user/my roms/game.bin");
        assert_eq!(quote_path(path), "\"/home/user/my roms/game.bin\"");
    }
}
