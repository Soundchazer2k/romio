// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// A known save-path entry from the migration registry database.
/// Schema for src-tauri/data/save_paths.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePathRule {
    pub emulator:        String,
    pub frontend:        Option<String>,
    pub version_from:    Option<String>,
    pub version_to:      Option<String>,
    pub old_path_pattern: String,
    pub new_path_pattern: String,
    pub trigger:         String,
    pub notes:           Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRoot {
    pub path:                 String,
    pub emulator:             String,
    pub is_symlink:           bool,
    pub real_path:            Option<String>,
    pub file_count:           u64,
    pub size_bytes:           u64,
    pub migration_state:      SaveMigrationState,
    pub expected_destination: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SaveMigrationState {
    /// Saves at old path only — migration needed
    MigrationNeeded,
    /// Saves at both old and new path — possible conflict
    ConflictDetected,
    /// Saves at new path only — already migrated
    AlreadyMigrated,
    /// No migration rule applies
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub source_path:      String,
    pub destination_path: String,
    pub file_count:       u64,
    pub size_bytes:       u64,
    pub emulator:         String,
    pub requires_backup:  bool,
    pub symlink_warning:  Option<String>,
    pub steps:            Vec<MigrationStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStep {
    pub order:       u32,
    pub action:      MigrationAction,
    pub description: String,
    pub reversible:  bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationAction {
    CreateCheckpoint,
    CopyFiles,
    MoveFiles,
    UpdateConfig,
    VerifyDestination,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckpoint {
    pub id:           String,
    pub project_id:   String,
    pub emulator:     String,
    pub source_path:  String,
    pub archive_path: String,
    pub created_at:   DateTime<Utc>,
    pub file_count:   u64,
    pub size_bytes:   u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationBlocker {
    NoActiveProject,
    CheckpointRequired,
    PlanRequired,
    ConflictDetected,
}
