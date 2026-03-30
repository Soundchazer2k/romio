// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};

/// A single entry in the BIOS rules database.
/// This is the schema for entries in src-tauri/data/bios_rules.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosRule {
    /// e.g. "scph5501.bin"
    pub filename:           String,
    /// Known-good MD5 hashes (may have multiple valid revisions)
    pub known_good_md5:     Vec<String>,
    /// Known bad-dump MD5 hashes — surface with explicit label
    pub known_bad_md5:      Vec<BadDumpEntry>,
    /// System this BIOS belongs to (e.g. "ps1", "saturn")
    pub system:             String,
    /// Region label (e.g. "US", "JP", "EU")
    pub region:             Option<String>,
    /// Whether the file must exist for games to launch
    pub requirement:        BiosRequirement,
    /// Whether this file should be compressed (.zip) or extracted
    pub compressed:         bool,
    /// Default placement path relative to the bios root
    pub default_path:       String,
    /// Frontend-specific path overrides — keyed by frontend id
    pub frontend_paths:     std::collections::HashMap<String, String>,
    /// Emulator-specific path overrides — keyed by emulator id
    pub emulator_paths:     std::collections::HashMap<String, String>,
    /// Human-readable notes for the UI
    pub notes:              Option<String>,
    /// Link to official dumping guide
    pub dumping_guide_url:  Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BadDumpEntry {
    pub md5:   String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BiosRequirement {
    Required,
    Optional,
    KeysCrypto,
    NotRequired,
}

/// Result of validating BIOS for a single system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosSystemResult {
    pub system:    String,
    pub entries:   Vec<BiosEntryResult>,
    pub blocking:  bool,  // true if any Required entry is missing
    pub errored:   bool,  // true if validation failed for this system during a sweep
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosEntryResult {
    pub rule:           BiosRule,
    pub found_path:     Option<String>,
    pub found_md5:      Option<String>,
    pub state:          crate::models::artifact::BiosValidationState,
    pub rename_from:    Option<String>, // if found under wrong filename
    pub bad_dump_label: Option<String>, // if hash matches a known bad dump
}
