// SPDX-License-Identifier: GPL-3.0
//! Format compatibility validation engine.
//! Checks ROM container formats against emulator support for the active frontend.

use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use crate::models::format::{FormatRule, FormatCheckResult, FormatSupport, FormatFixAction, FormatFixType, SystemFolder};
use crate::models::artifact::FormatCompatibilityState;

/// List a library's system folders and the game files in each.
///
/// A frontend install (RetroBat, Batocera, ES-DE) keeps games in `roms/`, so that is
/// used when present; otherwise `root` itself holds the system folders. See
/// `is_game_file` for what counts as a game, and `games_under` for subfolders.
pub fn list_system_folders(root: &Path, rules: &[FormatRule]) -> Result<Vec<SystemFolder>> {
    let roms = root.join("roms");
    let base = if roms.is_dir() { roms } else { root.to_path_buf() };
    let real_base = std::fs::canonicalize(&base)?;

    let mut dirs = std::fs::read_dir(&base)?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    dirs.retain(|p| p.is_dir());
    dirs.sort();

    Ok(dirs.into_iter().map(|dir| {
        let name = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
        let path = dir.to_string_lossy().to_string();
        let system = system_for_folder(&name);
        let (files, error, unchecked_subfolders) = games_under(&dir, &real_base, &system, rules);
        SystemFolder { name, path, system, files, error, unchecked_subfolders }
    }).collect())
}

/// Game files in a system folder and its subfolders, the first read failure if any, and
/// whether an installed-tree system left a nested file without a row.
///
/// Every frontend walks subfolders with no depth limit by default, so this does too.
/// A folder named with a game format (`<game>.easyrpg/`, `<game>.cue/`) is one game, as it is
/// to the frontends. Disc sheets match their tracks within each folder. Links are followed, as
/// the frontends do, except into another system's folder, where its games would be judged as the
/// wrong system, or up to a folder holding this one, which would walk the whole library.
///
/// shortcut: below an `INSTALLED_TREE_SYSTEMS` folder, only formats the system's rules name are
/// listed, so a game there in a format the rules miss gets no row; `unchecked_subfolders` tells
/// the user. Add a system to the list if its game folders fill up with Unknown rows.
fn games_under(system_dir: &Path, real_base: &Path, system: &str, rules: &[FormatRule]) -> (Vec<String>, Option<String>, bool) {
    let real_root = match std::fs::canonicalize(system_dir) {
        Ok(real) => real,
        Err(e) => return (Vec::new(), Some(e.to_string()), false),
    };
    let (mut files, mut error, mut seen, mut unchecked_file) = (Vec::new(), None, HashSet::new(), false);
    let mut pending = vec![system_dir.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let real = match std::fs::canonicalize(&dir) {
            Ok(real) => real,
            Err(e) => { error.get_or_insert(e.to_string()); continue; }
        };
        // A symlink or junction can lead back to a folder already walked
        if seen.contains(&real) { continue; }
        let other_system = real.starts_with(real_base) && !real.starts_with(&real_root);
        let holds_library = real_root.starts_with(&real) || real_base.starts_with(&real);
        if dir != system_dir && (other_system || holds_library) {
            error.get_or_insert(format!(
                "{} links to another system's folder or a folder holding this one, so it wasn't followed",
                dir.display(),
            ));
            continue;
        }
        seen.insert(real);
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => { error.get_or_insert(e.to_string()); continue; }
        };
        let mut paths = Vec::new();
        for entry in entries {
            match entry {
                Ok(entry) => paths.push(entry.path()),
                Err(e) => { error.get_or_insert(e.to_string()); }
            }
        }
        let (candidates, subfolders): (Vec<PathBuf>, Vec<PathBuf>) = paths.into_iter()
            .partition(|p| p.is_file() || is_game_folder(p, system, rules));
        pending.extend(subfolders.into_iter().filter(|p| p.is_dir() && !is_non_game_folder(p)));

        let rules_only = dir != system_dir && INSTALLED_TREE_SYSTEMS.contains(&system);
        let companions = disc_companions(&candidates);
        for path in candidates.iter().filter(|p| !is_disc_track(p, &companions, system, rules)) {
            if is_game_file(path, system, rules) && (!rules_only || rules_name_format(path, system, rules)) {
                files.push(path.to_string_lossy().to_string());
            } else if rules_only && path.is_file() && !rules_name_format(path, system, rules) {
                unchecked_file = true;
            }
        }
    }
    files.sort();
    (files, error, unchecked_file)
}

/// Systems whose game folders hold whole installs or companion data, full of files with
/// ROM-like extensions (`EBOOT.BIN`, `readme.md`, a MAME set's CHD folder).
const INSTALLED_TREE_SYSTEMS: &[&str] = &[
    "arcade", "dos", "gog", "ports", "ps3", "ps4", "ps5", "scummvm", "teknoparrot",
    "wiiu", "windows", "xbox", "xbox360",
];

/// A folder the frontends would show as one game. Playlists aren't games, so a `<game>.m3u/`
/// folder is walked and its discs are checked like loose ones.
fn is_game_folder(path: &Path, system: &str, rules: &[FormatRule]) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    path.is_dir() && !is_non_game_folder(path) && ext != "m3u"
        && (ext == "easyrpg" || rules_name_format(path, system, rules))
}

fn rules_name_format(path: &Path, system: &str, rules: &[FormatRule]) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    rules.iter().any(|r| r.system == system && r.extension == ext)
}

/// Folders Batocera and RetroBat never look in for games (SystemData::populateFolder), plus saves.
const NON_GAME_FOLDERS: &[&str] = &[
    "media", "medias", "images", "manuals", "videos", "assets", "html_arrm", "bezels",
    "fonts", "logs", "screenshots", "artwork", "saves",
];

/// ES-DE adds `noload.txt`, its marker for a folder to leave alone, such as a texture pack.
fn is_non_game_folder(dir: &Path) -> bool {
    let name = dir.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    name.starts_with('.') || name.starts_with("downloaded_")
        || NON_GAME_FOLDERS.contains(&name.as_str())
        || dir.join("noload.txt").exists()
}

/// A file a disc sheet names is that game's track, unless this system's rules judge its format:
/// then it has a verdict worth showing, and may be a game in its own right.
fn is_disc_track(path: &Path, companions: &HashSet<String>, system: &str, rules: &[FormatRule]) -> bool {
    let named = path.file_name().is_some_and(|n| companions.contains(&n.to_string_lossy().to_lowercase()));
    named && !rules_name_format(path, system, rules)
}

/// Real disc sheets are a few kilobytes. Anything bigger isn't one.
const MAX_SHEET_BYTES: u64 = 1024 * 1024;

/// Lowercased names of the files the disc sheets in this folder point at. A sheet that is
/// malformed or can't be read names nothing, so its files stay listed: a wrong Unknown row
/// beats a game silently left unchecked.
///
/// shortcut: names compare case-insensitively, so on Linux a sheet can hide two files differing
/// only by case. Compare exactly if that ever turns up.
fn disc_companions(files: &[PathBuf]) -> HashSet<String> {
    let mut names = HashSet::new();
    for path in files {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "cue" | "gdi" | "ccd") { continue; }
        if std::fs::metadata(path).map_or(true, |m| m.len() > MAX_SHEET_BYTES) { continue; }
        let Ok(bytes) = std::fs::read(path) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let text = text.trim_start_matches('\u{feff}');
        match ext.as_str() {
            "cue" => names.extend(cue_files(text)),
            "gdi" => names.extend(gdi_files(text)),
            _ if text.trim_start().starts_with("[CloneCD]") => {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_lowercase();
                names.insert(format!("{stem}.img"));
                names.insert(format!("{stem}.sub"));
            }
            _ => {}
        }
    }
    names
}

/// Files in a .cue that hold a track: `FILE "a.bin" BINARY` followed by `TRACK 01 ...`.
fn cue_files(text: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut pending = None;
    for line in text.lines() {
        let mut tokens = line.split_whitespace();
        let Some(keyword) = tokens.next() else { continue };
        if keyword.eq_ignore_ascii_case("file") {
            pending = sheet_name(line, tokens.next());
        } else if keyword.eq_ignore_ascii_case("track") {
            files.extend(pending.take());
        }
    }
    files
}

/// Files in a .gdi: a track count, then that many `1 0 4 2352 a.bin 0` records. Anything else
/// isn't a sheet Flycast would load, so it names nothing.
fn gdi_files(text: &str) -> Vec<String> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let Some(count) = lines.next().and_then(|l| l.trim().parse::<usize>().ok()) else { return vec![] };
    let files: Option<Vec<String>> = lines.take(count).map(|line| {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let numbered = tokens.len() >= 5 && tokens[..4].iter().all(|t| t.parse::<u32>().is_ok());
        if numbered { sheet_name(line, tokens.get(4).copied()) } else { None }
    }).collect();
    files.filter(|f| f.len() == count).unwrap_or_default()
}

/// The quoted name on a sheet line, or its unquoted one.
fn sheet_name(line: &str, unquoted: Option<&str>) -> Option<String> {
    let name = match line.split_once('"') {
        Some((_, rest)) => rest.split_once('"')?.0,
        None => unquoted?,
    };
    Some(name.to_lowercase())
}

/// Romio system ID for a frontend's roms/ folder name.
/// Sources: ES-DE es_systems.xml, RetroBat es_systems.cfg, Batocera es_systems.yml.
pub fn system_for_folder(folder: &str) -> String {
    let name = folder.to_lowercase();
    match name.as_str() {
        "psx" => "ps1",
        "gc" => "gamecube",
        "n3ds" => "3ds",
        "megadrive" | "megadrivejp" => "genesis",
        "megacd" | "megacdjp" => "segacd",
        "sega32xjp" | "sega32xna" => "sega32x",
        "saturnjp" => "saturn",
        "sfc" | "snesna" => "snes",
        "famicom" => "nes",
        "pcenginecd" | "tg-cd" => "tg16cd",
        "amiga500" | "amiga1200" => "amiga",
        "mame" => "arcade",
        "atarijaguar" => "jaguar",
        "tg16" => "pcengine",
        "neogeocdjp" => "neogeocd",
        "naomigd" => "naomi",
        "doom" => "gzdoom",
        _ => return name,
    }.to_string()
}

/// Formats that are rarely games outside their own system, so a system's rules can rule
/// them out. Rules aren't a full format list, so any other known extension stays listed:
/// a wrong Unknown row beats a game silently left unchecked.
const SCOPED_EXTENSIONS: &[&str] = &["car", "ids", "min", "bs", "easyrpg", "dat", "lst"];

/// A file is a game when its system's rules name its extension, or the extension is known
/// and nothing rules it out. That leaves out gamelist.xml, .m3u playlists and artwork.
fn is_game_file(path: &Path, system: &str, rules: &[FormatRule]) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext == "m3u" { return false; }
    if rules.iter().any(|r| r.system == system && r.extension == ext) { return true; }
    // .png is usually artwork. TIC-80 has no rules yet, and standalone TIC-80 loads .png carts.
    if ext == "png" { return system == "tic80"; }
    if SCOPED_EXTENSIONS.contains(&ext.as_str()) && rules.iter().any(|r| r.system == system) { return false; }
    crate::engine::scanner::is_rom_extension(&ext) || rules.iter().any(|r| r.extension == ext)
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
            condition: None,
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
                condition: None,
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
                    condition: None,
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
                condition: None,
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
                notes: r.notes.clone(),
                condition: Some(condition.clone()),
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
    fn conditional_rule_reports_its_condition_and_keeps_its_notes() {
        let rules = vec![FormatRule {
            system: "xbox".into(), extension: "iso".into(), emulator: "xemu".into(), frontend: None,
            support: FormatSupport::Conditional { condition: "Must be an XISO".into() },
            notes: Some("xemu docs".into()), since_version: None,
        }];
        let result = check_format(Path::new("Halo.iso"), &rules, "xbox", "xemu", "esde");
        assert_eq!(result.state, FormatCompatibilityState::Compatible);
        assert_eq!(result.condition.as_deref(), Some("Must be an XISO"));
        assert_eq!(result.notes.as_deref(), Some("xemu docs"));
    }

    #[test]
    fn maps_frontend_folder_names_to_system_ids() {
        for (folder, system) in [
            ("psx", "ps1"), ("PSX", "ps1"), ("gc", "gamecube"), ("n3ds", "3ds"),
            ("megadrive", "genesis"), ("megacd", "segacd"), ("atarijaguar", "jaguar"),
            ("tg16", "pcengine"), ("neogeocdjp", "neogeocd"), ("naomigd", "naomi"), ("doom", "gzdoom"),
            ("gamecube", "gamecube"), ("xbox360", "xbox360"), ("Foo", "foo"),
        ] {
            assert_eq!(system_for_folder(folder), system);
        }
    }

    #[test]
    fn deprecated_rule_offers_a_rename() {
        let rules = vec![FormatRule {
            system: "x".into(), extension: "old".into(), emulator: "e".into(), frontend: None,
            support: FormatSupport::Deprecated { replacement: "new".into() },
            notes: None, since_version: None,
        }];
        let result = check_format(Path::new("Game.old"), &rules, "x", "e", "esde");
        assert_eq!(result.state, FormatCompatibilityState::FormatDeprecated);
        assert_eq!(result.fix_action.and_then(|f| f.new_filename).as_deref(), Some("Game.new"));
    }

    #[test]
    fn missing_root_is_an_error_not_an_empty_library() {
        assert!(list_system_folders(Path::new("Z:/no/such/romio/library"), &[]).is_err());
    }

    #[test]
    fn lists_a_disc_once_not_the_files_its_sheet_names() {
        let dir = tempfile::tempdir().unwrap();
        let psx = dir.path().join("psx");
        fs::create_dir_all(&psx).unwrap();
        let oversized = format!("FILE \"big.bin\" BINARY\nTRACK 01 MODE2/2352\n{}", " ".repeat(1024 * 1024));
        let sheets: [(&str, &[u8]); 9] = [
            ("a.cue", b"REM \"not.bin\"\nFILE \"a (Track 1).bin\" BINARY\n  TRACK 01 MODE2/2352\nfile \"A (TRACK 2).BIN\" BINARY\n  TRACK 02 AUDIO\n"),
            ("b.gdi", b"2\n1 0 4 2352 track01.bin 0\n2 450 0 2352 \"track 02.bin\" 0\n"),
            ("d.cue", "\u{feff}FILE d.bin BINARY\nTRACK 01 MODE1/2352\n".as_bytes()),
            ("broken.cue", &[0xff, 0xfe, 0x00, 0x22]),
            ("c.ccd", b"[CloneCD]\n"),
            // None of these describe a disc, so they name nothing
            ("notrack.cue", b"FILE \"notrack.bin\" BINARY\n"),
            ("stray.gdi", b"note \"stray.bin\"\n"),
            ("short.gdi", b"2\n1 0 4 2352 short.bin 0\n"),
            ("fake.ccd", b"not a CloneCD sheet"),
        ];
        for (name, contents) in sheets {
            fs::write(psx.join(name), contents).unwrap();
        }
        fs::write(psx.join("big.cue"), oversized).unwrap();
        for name in [
            "a (Track 1).bin", "a (Track 2).bin", "track01.bin", "track 02.bin", "d.bin",
            "c.img", "c.sub", "not.bin", "orphan.bin", "lone.img",
            "notrack.bin", "stray.bin", "short.bin", "fake.img", "big.bin",
        ] {
            fs::write(psx.join(name), b"x").unwrap();
        }

        let folders = list_system_folders(dir.path(), &[]).unwrap();
        let listed: Vec<_> = folders[0].files.iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(listed, [
            "a.cue", "b.gdi", "big.bin", "big.cue", "broken.cue", "c.ccd", "d.cue", "fake.ccd", "fake.img",
            "lone.img", "not.bin", "notrack.bin", "notrack.cue", "orphan.bin", "short.bin", "short.gdi",
            "stray.bin", "stray.gdi",
        ]);
    }

    #[test]
    fn a_sheet_never_hides_a_file_with_a_verdict_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let psx = dir.path().join("psx");
        fs::create_dir_all(&psx).unwrap();
        fs::write(psx.join("c.ccd"), b"[CloneCD]\n").unwrap();
        fs::write(psx.join("c.img"), b"x").unwrap();
        fs::write(psx.join("c.sub"), b"x").unwrap();
        let rules = vec![FormatRule {
            system: "ps1".into(), extension: "img".into(), emulator: "duckstation".into(),
            frontend: None, support: FormatSupport::Supported, notes: None, since_version: None,
        }];

        let folders = list_system_folders(dir.path(), &rules).unwrap();
        let listed: Vec<_> = folders[0].files.iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(listed, ["c.ccd", "c.img"]);
    }
}
