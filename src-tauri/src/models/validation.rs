// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// An entry in the operation log — every write action Romio takes is logged here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntry {
    pub id:           Uuid,
    pub operation:    String,
    pub description:  String,
    pub affected_paths: Vec<String>,
    pub reversible:   bool,
    pub rolled_back:  bool,
    pub created_at:   DateTime<Utc>,
}

/// Result of the three-layer smoke test
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeTestResult {
    pub parse_valid:   bool,
    pub launch_valid:  bool,
    pub runtime_notes: Vec<String>,
    pub findings:      Vec<crate::models::artifact::ValidationFinding>,
}
