// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// The canonical artifact type — every file in the library is one of these.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id:                   Uuid,
    pub artifact_type:        ArtifactType,
    pub source_path:          String,
    pub normalized_path:      String,
    pub md5_hash:             Option<String>,
    pub file_size:            Option<u64>,
    pub detected_system:      Option<String>,
    pub detected_format:      Option<String>,
    pub bios_state:           BiosValidationState,
    pub format_state:         FormatCompatibilityState,
    pub frontend_tags:        Vec<String>,
    pub scan_visibility:      ScanVisibility,
    pub title_id:             Option<String>,
    pub export_status:        ExportStatus,
    pub validation_findings:  Vec<ValidationFinding>,
    pub save_root_association: Option<SaveRootAssociation>,
    pub notes:                Option<String>,
    pub scanned_at:           DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactType {
    Rom,
    Bios,
    FirmwareInstaller,
    MultiDiscComponent,
    M3u,
    ScummvmDir,
    ScummvmPointer,
    InstalledTitle,
    Shortcut,
    Wrapper,
    SaveRoot,
    Helper,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BiosValidationState {
    PresentValid,
    PresentWrongPath,
    PresentHashMismatch,
    MissingRequired,
    MissingOptional,
    NotApplicable,
}

impl Default for BiosValidationState {
    fn default() -> Self { Self::NotApplicable }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormatCompatibilityState {
    Compatible,
    FormatIncompatible,
    FormatDeprecated,
    Unknown,
    NotApplicable,
}

impl Default for FormatCompatibilityState {
    fn default() -> Self { Self::NotApplicable }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ScanVisibility {
    Visible,
    Hidden,
    HelperOnly,
    ExportOnly,
}

impl Default for ScanVisibility {
    fn default() -> Self { Self::Visible }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    NotExported,
    Pending,
    Exported,
    Stale,
    Error,
}

impl Default for ExportStatus {
    fn default() -> Self { Self::NotExported }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationFinding {
    pub severity:           FindingSeverity,
    pub issue_type:         String,
    pub description:        String,
    pub recommended_action: Option<String>,
    pub auto_fixable:       bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Blocking,
    Error,
    Warning,
    Advisory,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRootAssociation {
    pub save_root_path:    String,
    pub emulator:          String,
    pub emulator_version:  Option<String>,
    pub last_write_time:   Option<DateTime<Utc>>,
}
