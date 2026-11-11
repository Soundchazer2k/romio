// SPDX-License-Identifier: GPL-3.0
//! ScummVM game folder detection.
//! Recognises a game by the data files in its folder, and finds its pointer file.
//! Read-only: nothing here writes a pointer.

use anyhow::Result;
use std::collections::HashSet;
use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::engine::format_matrix::{is_non_game_folder, system_for_folder};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScummVmGame {
    pub path: String,
    pub name: String,
    /// The engine whose data files were recognised, or None when none were
    pub engine: Option<String>,
    pub pointer_path: Option<String>,
    /// First line of the pointer file: the game ID the frontend passes to ScummVM. Empty means autodetect.
    pub pointer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScummVmReport {
    /// The scummvm system folder that was read, or None when the library has none
    pub folder: Option<String>,
    pub games:  Vec<ScummVmGame>,
}

/// List the game folders in a library's scummvm folder.
///
/// Uses `roms/` when present, like the format check. `root` may also be the scummvm folder itself.
///
/// shortcut: only pointer files inside a game's folder are matched; ones kept loose in the
/// scummvm folder aren't tied to a game. Upgrade when a frontend that needs that layout is supported.
pub fn detect_games(root: &Path) -> Result<ScummVmReport> {
    let roms = root.join("roms");
    let base = if roms.is_dir() { roms } else { root.to_path_buf() };

    let is_scummvm = |p: &Path| p.file_name()
        .is_some_and(|n| system_for_folder(&n.to_string_lossy()) == "scummvm");

    let folder = if is_scummvm(&base) {
        Some(base.clone())
    } else {
        let mut dirs = subfolders(&base)?;
        dirs.retain(|p| is_scummvm(p));
        dirs.into_iter().next()
    };
    let Some(folder) = folder else { return Ok(ScummVmReport { folder: None, games: vec![] }) };

    let mut games = Vec::new();
    // Scraped media and the like sit beside the games and aren't games
    for dir in subfolders(&folder)?.into_iter().filter(|d| !is_non_game_folder(d)) {
        let mut files: Vec<_> = std::fs::read_dir(&dir)?
            .collect::<std::io::Result<Vec<_>>>()?
            .into_iter()
            .filter(|e| e.path().is_file())
            .map(|e| e.path())
            .collect();
        files.sort();

        let names: HashSet<String> = files.iter()
            .filter_map(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_lowercase())
            .collect();

        let pointer = files.iter().find(|p| {
            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("scummvm"))
        });
        let pointer_id = pointer.map(|p| {
            std::fs::read(p).ok()
                .map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').lines().next().unwrap_or("").trim().to_string())
                .unwrap_or_default()
        });

        games.push(ScummVmGame {
            name: dir.file_name().unwrap_or_default().to_string_lossy().to_string(),
            path: dir.to_string_lossy().to_string(),
            engine: detect_engine(&names).map(String::from),
            pointer_path: pointer.map(|p| p.to_string_lossy().to_string()),
            pointer_id,
        });
    }
    Ok(ScummVmReport { folder: Some(folder.to_string_lossy().to_string()), games })
}

fn subfolders(dir: &Path) -> Result<Vec<std::path::PathBuf>> {
    let mut dirs = std::fs::read_dir(dir)
        .map_err(|e| anyhow::anyhow!("Couldn't read {}: {e}", dir.display()))?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    dirs.retain(|p| p.is_dir());
    dirs.sort();
    Ok(dirs)
}

/// The engine a folder's data files belong to, from lowercased file names.
///
/// shortcut: a handful of engines with unmistakable data files. A folder that matches none
/// may still be a ScummVM game. Upgrade by adding signatures as engines are asked for.
fn detect_engine(names: &HashSet<String>) -> Option<&'static str> {
    let has = |n: &str| names.contains(n);
    let any_ext = |ext: &str| names.iter().any(|n| n.ends_with(ext));

    if has("resource.map") || has("resmap.000") || has("resmap.001") {
        return Some("SCI");
    }
    if has("logdir") && has("picdir") && has("viewdir") {
        return Some("AGI");
    }
    if has("gamepc") {
        return Some("AGOS");
    }
    let numbered_pair = names.iter()
        .filter_map(|n| n.strip_suffix(".000"))
        .any(|stem| names.contains(&format!("{stem}.001")));
    if any_ext(".lfl") || any_ext(".he0") || any_ext(".la0") || numbered_pair {
        return Some("SCUMM");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn engines_are_recognised_by_their_data_files() {
        assert_eq!(detect_engine(&names(&["00.lfl", "01.lfl"])), Some("SCUMM"));
        assert_eq!(detect_engine(&names(&["game.000", "game.001"])), Some("SCUMM"));
        assert_eq!(detect_engine(&names(&["game.he0", "game.he1"])), Some("SCUMM"));
        assert_eq!(detect_engine(&names(&["resource.map", "resource.000", "resource.001"])), Some("SCI"));
        assert_eq!(detect_engine(&names(&["logdir", "picdir", "viewdir", "words.tok"])), Some("AGI"));
        assert_eq!(detect_engine(&names(&["gamepc", "icon.dat"])), Some("AGOS"));
    }

    #[test]
    fn a_folder_of_other_files_matches_no_engine() {
        assert_eq!(detect_engine(&names(&["readme.txt", "game.000"])), None);
        assert_eq!(detect_engine(&names(&[])), None);
    }
}
