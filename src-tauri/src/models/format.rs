// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};

/// A format compatibility rule.
/// Schema for src-tauri/data/format_matrix.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatRule {
    pub system:       String,
    pub extension:    String,
    pub emulator:     String,
    pub frontend:     Option<String>,
    pub support:      FormatSupport,
    pub notes:        Option<String>,
    pub since_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FormatSupport {
    /// Fully supported
    Supported,
    /// Was supported, no longer is
    Deprecated { replacement: String },
    /// Never supported by this emulator
    Unsupported { reason: String },
    /// Supported but requires specific conditions
    Conditional { condition: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCheckResult {
    pub path:       String,
    pub extension:  String,
    pub system:     Option<String>,
    pub emulator:   Option<String>,
    pub state:      crate::models::artifact::FormatCompatibilityState,
    pub notes:      Option<String>,
    pub fix_action: Option<FormatFixAction>,
}

/// One system folder of a library, with the game files the Format check should look at.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFolder {
    pub name:  String,
    pub path:  String,
    /// Romio system ID for this folder name, e.g. `psx` is `ps1`
    pub system: String,
    pub files: Vec<String>,
    /// Set when the folder couldn't be listed; `files` is then empty
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatFixAction {
    pub action_type:  FormatFixType,
    pub description:  String,
    pub safe:         bool,
    pub new_filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatFixType {
    /// Safe — content unchanged, just filename
    Rename,
    /// Requires recompression — surface with warning
    Convert,
    /// User must re-dump
    Redump,
}
