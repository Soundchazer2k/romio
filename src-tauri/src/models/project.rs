// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id:               Uuid,
    pub name:             String,
    pub library_roots:    Vec<String>,
    pub target_frontends: Vec<String>,
    pub emulator_prefs:   std::collections::HashMap<String, String>,
    pub created_at:       DateTime<Utc>,
    pub last_scanned_at:  Option<DateTime<Utc>>,
    pub scan_stats:       Option<ScanStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub total_files:     u64,
    pub classified:      u64,
    pub blocking_issues: u32,
    pub errors:          u32,
    pub warnings:        u32,
    pub advisories:      u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name:             String,
    pub library_roots:    Vec<String>,
    pub target_frontends: Vec<String>,
}
