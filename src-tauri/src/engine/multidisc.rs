// SPDX-License-Identifier: GPL-3.0
//! Multi-disc set detection.
//! Groups disc images by name, checks each sheet's track files, and checks the set's M3U.
//! Read-only: nothing here writes or groups anything on disk.

use anyhow::Result;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::engine::format_matrix::{cue_files, gdi_files, system_for_folder};

/// One disc image per disc, best first: a sheet stands for its track files.
const DISC_EXTENSIONS: &[&str] = &["cue", "gdi", "ccd", "chd", "rvz", "iso", "pbp", "cso", "bin", "img"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscFile {
    pub path: String,
    /// "1", "2", or a letter such as "A"
    pub disc: String,
    /// Track files a .cue or .gdi names that aren't beside it
    pub missing_tracks: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum M3uState {
    Missing,
    Complete,
    Incomplete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiDiscSet {
    pub name:   String,
    pub folder: String,
    /// Romio system ID of the top-level folder the set sits under
    pub system: String,
    pub discs:  Vec<DiscFile>,
    pub m3u_path:  Option<String>,
    pub m3u_state: M3uState,
    /// What is wrong with an incomplete M3U, in plain words
    pub m3u_problems: Vec<String>,
}

/// Find every set of two or more discs under `root`.
///
/// Uses `roms/` when present, like the format check. A folder that can't be read fails the
/// whole run: a partial list would look like a library with fewer sets.
///
/// shortcut: only bracketed tags such as "(Disc 2)" or "[CD 1]" in the file name count, so
/// sets named "Game - Disc 2" or kept one disc per folder aren't found. Upgrade when one turns up.
pub fn detect_sets(root: &Path) -> Result<Vec<MultiDiscSet>> {
    let roms = root.join("roms");
    let base = if roms.is_dir() { roms } else { root.to_path_buf() };

    // (folder, lowercased name without its disc tag) -> (name, disc images as (disc, format rank, path))
    let mut groups: BTreeMap<(PathBuf, String), (String, Vec<(String, usize, PathBuf)>)> = BTreeMap::new();
    let mut playlists: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();

    for entry in WalkDir::new(&base).follow_links(false) {
        let entry = entry.map_err(|e| crate::engine::scanner::walk_error(&base, &e))?;
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();
        let Some(dir) = path.parent() else { continue };
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if ext == "m3u" {
            playlists.entry(dir.to_path_buf()).or_default().push(path.to_path_buf());
            continue;
        }
        let Some(rank) = DISC_EXTENSIONS.iter().position(|e| *e == ext) else { continue };
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        // "Game (Disc 1) (Track 2).bin" is one track of a disc, not a disc
        if stem.to_lowercase().contains("(track ") { continue; }
        let Some((name, disc)) = split_disc_tag(&stem) else { continue };
        groups.entry((dir.to_path_buf(), name.to_lowercase()))
            .or_insert_with(|| (name, Vec::new()))
            .1.push((disc, rank, path.to_path_buf()));
    }

    let mut sets = Vec::new();
    for ((dir, _), (name, mut discs)) in groups {
        // One image per disc, best format first, so a .cue's own .bin isn't a second disc.
        // Per disc, not per set: a set can mix formats.
        discs.sort_by_key(|(disc, rank, _)| (disc_order(disc), *rank));
        discs.dedup_by(|a, b| a.0 == b.0);
        if discs.len() < 2 { continue; }

        let discs: Vec<DiscFile> = discs.into_iter().map(|(disc, _, path)| DiscFile {
            missing_tracks: missing_tracks(&path),
            path: path.to_string_lossy().to_string(),
            disc,
        }).collect();

        // A playlist beside the discs, or one folder up (discs kept in a subfolder)
        let candidates = playlists.get(&dir).into_iter()
            .chain(dir.parent().and_then(|p| playlists.get(p)))
            .flatten();
        let (m3u_path, m3u_state, m3u_problems) = candidates
            .filter_map(|m3u| check_m3u(m3u, &name, &discs))
            .next()
            .unwrap_or((None, M3uState::Missing, vec![]));

        // Discs directly in the root mean the root is itself a system folder
        let top = dir.strip_prefix(&base).ok()
            .and_then(|rel| rel.components().next())
            .map(|c| c.as_os_str())
            .or(base.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        sets.push(MultiDiscSet {
            name,
            folder: dir.to_string_lossy().to_string(),
            system: system_for_folder(&top),
            discs,
            m3u_path,
            m3u_state,
            m3u_problems,
        });
    }
    Ok(sets)
}

/// Split "Name (Disc 2)" into ("Name", "2"). The tag is a bracket group starting with
/// disc, disk or cd, then a number or a single letter ("Disc 1 of 3" counts).
fn split_disc_tag(stem: &str) -> Option<(String, String)> {
    let mut from = 0;
    while let Some(open) = stem[from..].find(['(', '[']).map(|i| i + from) {
        let close_char = if stem.as_bytes()[open] == b'(' { ')' } else { ']' };
        let Some(close) = stem[open..].find(close_char).map(|i| i + open) else { break };
        from = open + 1;
        let inner = stem[open + 1..close].to_lowercase();
        let Some(rest) = ["disc", "disk", "cd"].iter().find_map(|p| inner.strip_prefix(p)) else { continue };
        let Some(token) = rest.split_whitespace().next() else { continue };
        let disc = if token.chars().all(|c| c.is_ascii_digit()) {
            let trimmed = token.trim_start_matches('0');
            if trimmed.is_empty() { "0".to_string() } else { trimmed.to_string() }
        } else if token.len() == 1 && token.chars().all(|c| c.is_ascii_alphabetic()) {
            token.to_uppercase()
        } else {
            continue;
        };
        let name = format!("{}{}", &stem[..open], &stem[close + 1..]);
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() { return None; }
        return Some((name, disc));
    }
    None
}

/// Numbers in order, then letters.
fn disc_order(disc: &str) -> (u8, u32, String) {
    match disc.parse::<u32>() {
        Ok(n) => (0, n, String::new()),
        Err(_) => (1, 0, disc.to_string()),
    }
}

/// Track files a sheet names that aren't in its folder. A sheet that can't be read names none.
fn missing_tracks(sheet: &Path) -> Vec<String> {
    let ext = sheet.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "cue" && ext != "gdi" { return vec![]; }
    let Ok(bytes) = std::fs::read(sheet) else { return vec![] };
    let text = String::from_utf8_lossy(&bytes);
    let text = text.trim_start_matches('\u{feff}');
    let named = if ext == "cue" { cue_files(text) } else { gdi_files(text) };

    let present: HashSet<String> = sheet.parent()
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .into_iter().flatten().flatten()
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .collect();
    let mut missing: Vec<String> = named.into_iter().filter(|n| !present.contains(n)).collect();
    missing.sort();
    missing.dedup();
    missing
}

/// How a playlist covers a set, or None when it isn't this set's: it lists none of the
/// set's discs and isn't named after the set.
fn check_m3u(m3u: &Path, name: &str, discs: &[DiscFile]) -> Option<(Option<String>, M3uState, Vec<String>)> {
    let bytes = std::fs::read(m3u).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let dir = m3u.parent()?;

    let same = |a: &Path, b: &Path| match (dunce::canonicalize(a), dunce::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };

    let mut listed = HashSet::new();
    let mut problems = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        // Playlists written on Windows use backslashes; the frontends on other systems don't accept them
        let target = dir.join(line.replace('\\', std::path::MAIN_SEPARATOR_STR));
        match discs.iter().position(|d| same(&target, Path::new(&d.path))) {
            Some(i) => { listed.insert(i); }
            None if !target.exists() => problems.push(format!("It lists {line}, which doesn't exist.")),
            None => {}
        }
    }
    let named_after_set = m3u.file_stem().is_some_and(|s| s.to_string_lossy().eq_ignore_ascii_case(name));
    if listed.is_empty() && !named_after_set { return None; }

    for (i, disc) in discs.iter().enumerate() {
        if !listed.contains(&i) {
            problems.push(format!("Disc {} isn't listed.", disc.disc));
        }
    }
    let state = if problems.is_empty() { M3uState::Complete } else { M3uState::Incomplete };
    Some((Some(m3u.to_string_lossy().to_string()), state, problems))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disc_tags_are_read_from_bracket_groups() {
        assert_eq!(split_disc_tag("Game (USA) (Disc 2)"), Some(("Game (USA)".into(), "2".into())));
        assert_eq!(split_disc_tag("Game [CD 01]"), Some(("Game".into(), "1".into())));
        assert_eq!(split_disc_tag("Game (Disk B) (Rev 1)"), Some(("Game (Rev 1)".into(), "B".into())));
        assert_eq!(split_disc_tag("Game (Disc 1 of 3)"), Some(("Game".into(), "1".into())));
        assert_eq!(split_disc_tag("Game (Disc2)"), Some(("Game".into(), "2".into())));
        // Not a disc tag: no number, a word, or no brackets
        assert_eq!(split_disc_tag("Game (Disc)"), None);
        assert_eq!(split_disc_tag("Game (Discovery Edition)"), None);
        assert_eq!(split_disc_tag("Game Disc 2"), None);
        assert_eq!(split_disc_tag("(Disc 1)"), None);
    }

    #[test]
    fn numbered_discs_sort_before_lettered_ones() {
        let mut discs = vec!["B", "10", "2", "A"];
        discs.sort_by_key(|d| disc_order(d));
        assert_eq!(discs, vec!["2", "10", "A", "B"]);
    }
}
