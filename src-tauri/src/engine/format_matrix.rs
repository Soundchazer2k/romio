// SPDX-License-Identifier: GPL-3.0
//! Format compatibility validation engine.
//! Checks ROM container formats against emulator support for the active frontend.

use anyhow::Result;
use std::path::Path;
use crate::models::format::{FormatRule, FormatCheckResult, FormatSupport, FormatFixAction, FormatFixType, SystemFolder};
use crate::models::artifact::FormatCompatibilityState;

/// List a library's system folders and the game files in each.
///
/// A frontend install (RetroBat, Batocera, ES-DE) keeps games in `roms/`, so that is
/// used when present; otherwise `root` itself holds the system folders. A file counts
/// as a game when the scanner knows its extension or a format rule mentions it, which
/// leaves out gamelist.xml, artwork and .m3u playlists.
pub fn list_system_folders(root: &Path, rules: &[FormatRule]) -> Result<Vec<SystemFolder>> {
    let roms = root.join("roms");
    let base = if roms.is_dir() { roms } else { root.to_path_buf() };

    let mut dirs: Vec<_> = std::fs::read_dir(&base)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();

    Ok(dirs.into_iter().map(|dir| {
        let name = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
        let path = dir.to_string_lossy().to_string();
        match std::fs::read_dir(&dir) {
            Err(e) => SystemFolder { name, path, files: vec![], error: Some(e.to_string()) },
            Ok(entries) => {
                let mut files: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.is_file() && is_game_file(p, rules))
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                files.sort();
                SystemFolder { name, path, files, error: None }
            }
        }
    }).collect())
}

fn is_game_file(path: &Path, rules: &[FormatRule]) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    ext != "m3u"
        && (crate::engine::scanner::is_rom_extension(&ext) || rules.iter().any(|r| r.extension == ext))
}

/// Check a single file's format compatibility against the loaded rules.
pub fn check_format(
    path: &Path,
    rules: &[FormatRule],
    system: &str,
    emulator: &str,
    frontend: &str,
) -> FormatCheckResult {
    let extension = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Find the most specific matching rule:
    // emulator+frontend > emulator-only > system-only
    let rule = rules.iter()
        .filter(|r| r.system == system && r.extension == extension)
        .find(|r| {
            let emu_match = r.emulator == emulator;
            let fe_match  = r.frontend.as_deref() == Some(super::rules_frontend(frontend))
                         || r.frontend.is_none();
            emu_match && fe_match
        });

    match rule {
        None => FormatCheckResult {
            path: path.to_string_lossy().to_string(),
            extension,
            system: Some(system.to_string()),
            emulator: Some(emulator.to_string()),
            state: FormatCompatibilityState::Unknown,
            notes: Some("No compatibility rule found for this format/emulator combination.".to_string()),
            fix_action: None,
        },

        Some(r) => match &r.support {
            FormatSupport::Supported => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension,
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::Compatible,
                notes: r.notes.clone(),
                fix_action: None,
            },

            FormatSupport::Deprecated { replacement } => {
                let new_name = path.with_extension(replacement)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(String::from);

                FormatCheckResult {
                    path: path.to_string_lossy().to_string(),
                    extension: extension.clone(),
                    system: Some(system.to_string()),
                    emulator: Some(emulator.to_string()),
                    state: FormatCompatibilityState::FormatDeprecated,
                    notes: r.notes.clone(),
                    fix_action: Some(FormatFixAction {
                        action_type: FormatFixType::Rename,
                        description: format!(
                            "Rename .{} → .{} — content unchanged",
                            extension, replacement
                        ),
                        safe: true,
                        new_filename: new_name,
                    }),
                }
            }

            FormatSupport::Unsupported { reason } => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension: extension.clone(),
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::FormatIncompatible,
                notes: Some(reason.clone()),
                fix_action: Some(FormatFixAction {
                    action_type: FormatFixType::Redump,
                    description: format!(
                        ".{} is not supported by {}. Re-dump in a compatible format.",
                        extension, emulator
                    ),
                    safe: false,
                    new_filename: None,
                }),
            },

            FormatSupport::Conditional { condition } => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension,
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::Compatible,
                notes: Some(condition.clone()),
                fix_action: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_games_under_roms_and_skips_non_game_files() {
        let dir = tempfile::tempdir().unwrap();
        let roms = dir.path().join("roms");
        for f in ["psx/a.chd", "psx/gamelist.xml", "psx/b.m3u", "psp/c.zso", "psp/media/cover.png"] {
            let p = roms.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"x").unwrap();
        }
        fs::create_dir_all(dir.path().join("bios")).unwrap();
        let rules = vec![FormatRule {
            system: "psp".into(), extension: "zso".into(), emulator: "ppsspp".into(),
            frontend: None, support: FormatSupport::Supported, notes: None, since_version: None,
        }];

        // Given the install root, not roms/: bios/ must not show up as a system
        let folders = list_system_folders(dir.path(), &rules).unwrap();
        let names: Vec<_> = folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["psp", "psx"]);

        let file_names = |name: &str| -> Vec<String> {
            folders.iter().find(|f| f.name == name).unwrap().files.iter()
                .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string()).collect()
        };
        assert_eq!(file_names("psx"), ["a.chd"], "gamelist.xml and .m3u are not games");
        assert_eq!(file_names("psp"), ["c.zso"], "kept because a format rule names .zso; media/ is a subfolder");
    }

    #[test]
    fn missing_root_is_an_error_not_an_empty_library() {
        assert!(list_system_folders(Path::new("Z:/no/such/romio/library"), &[]).is_err());
    }
}
