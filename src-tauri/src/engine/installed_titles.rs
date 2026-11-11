// SPDX-License-Identifier: GPL-3.0
//! Installed-title checks for emulators that find games by folder, not by ROM file.
//! Checks each title folder's name and the files the emulator needs inside it.
//! Read-only: nothing here renames or writes anything.

use anyhow::{bail, Result};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::engine::shortcut_validator::{display_name, validate_title_id};

pub const EMULATORS: &[&str] = &["rpcs3", "shadps4", "vita3k", "cemu"];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TitleKind {
    Game,
    Update,
    /// No boot file: update data or add-on content, not something to launch
    Data,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleCheck {
    pub path:     String,
    pub folder:   String,
    pub title_id: Option<String>,
    pub kind:     TitleKind,
    /// What is wrong and how to fix it, in plain words. Empty when the title is fine.
    pub issues:   Vec<String>,
}

/// Check every folder in an emulator's installed-games folder.
pub fn check_titles(dir: &Path, emulator: &str) -> Result<Vec<TitleCheck>> {
    if !EMULATORS.contains(&emulator) {
        bail!("Romio has no installed-title rules for {emulator}.");
    }
    let mut dirs = std::fs::read_dir(dir)
        .map_err(|e| anyhow::anyhow!("Couldn't read {}: {e}", dir.display()))?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    // Not titles: RPCS3's .locks and $locks, and shadPS4's <ID>-mods overlay folders
    dirs.retain(|p| {
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        p.is_dir() && !name.starts_with(['.', '$']) && !(emulator == "shadps4" && name.ends_with("-mods"))
    });
    dirs.sort();

    Ok(dirs.iter().map(|path| check_title(path, emulator)).collect())
}

fn check_title(path: &Path, emulator: &str) -> TitleCheck {
    let folder = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut issues = Vec::new();

    // shadPS4 keeps a game's update beside it as <ID>-UPDATE or <ID>-patch
    let update_suffix = (emulator == "shadps4")
        .then(|| ["-update", "-patch"].iter().find(|s| folder.to_lowercase().ends_with(*s)))
        .flatten();
    let id_part = &folder[..folder.len() - update_suffix.map_or(0, |s| s.len())];

    // Cemu finds a title by the files inside it, not by its folder name
    let title_id = if emulator == "cemu" {
        None
    } else {
        match validate_title_id(id_part, emulator) {
            None => Some(id_part.to_string()),
            Some(issue) => {
                issues.push([Some(issue.description), issue.fix].into_iter().flatten().collect::<Vec<_>>().join(" "));
                None
            }
        }
    };

    let (boot, required): (&[&str], &[&[&str]]) = match emulator {
        "rpcs3"  => (&["USRDIR", "EBOOT.BIN"], &[&["PARAM.SFO"]]),
        "cemu"   => (&["code"], &[&["meta", "meta.xml"]]),
        _        => (&["eboot.bin"], &[&["sce_sys", "param.sfo"]]),
    };
    let bootable = match emulator {
        "cemu" => find(path, boot).is_some_and(|code| has_extension(&code, "rpx")),
        _      => find(path, boot).is_some(),
    };
    let shown = display_name(emulator);
    for rel in required {
        if find(path, rel).is_none() {
            issues.push(format!("{} is missing, so {shown} can't identify this title. Reinstall it through {shown}.", rel.join("/")));
        }
    }
    // Vita3K keeps updates and add-ons in ux0/patch and ux0/addcont, so everything in ux0/app must boot
    let must_boot = emulator == "vita3k";
    if must_boot && !bootable {
        issues.push(format!("eboot.bin is missing, so {shown} can't start this title. Reinstall it through {shown}."));
    }

    let kind = if update_suffix.is_some() {
        TitleKind::Update
    } else if bootable || must_boot {
        TitleKind::Game
    } else {
        TitleKind::Data
    };

    TitleCheck { path: path.to_string_lossy().to_string(), folder, title_id, kind, issues }
}

/// Follow `rel` below `dir`, matching each part without regard to case, as these
/// emulators' own files differ in case between dumps.
fn find(dir: &Path, rel: &[&str]) -> Option<PathBuf> {
    let mut current = dir.to_path_buf();
    for part in rel {
        current = std::fs::read_dir(&current).ok()?
            .flatten()
            .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(part))?
            .path();
    }
    Some(current)
}

fn has_extension(dir: &Path, ext: &str) -> bool {
    std::fs::read_dir(dir).into_iter().flatten().flatten()
        .any(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case(ext)))
}
