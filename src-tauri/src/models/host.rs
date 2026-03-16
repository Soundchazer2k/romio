// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostEnvironmentReport {
    pub platform:     String,
    pub checks:       Vec<DependencyCheck>,
    pub all_pass:     bool,
    pub blocking_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyCheck {
    pub id:                  String,
    pub name:                String,
    pub description:         String,
    pub affected_emulators:  Vec<String>,
    pub state:               DependencyState,
    pub detected_version:    Option<String>,
    pub minimum_version:     Option<String>,
    pub remediation:         Option<Remediation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyState {
    Present,
    PresentWrongVersion,
    Missing,
    NotApplicable, // e.g. Linux-only check on macOS
    Skipped,       // e.g. Flatpak emulator — system check not valid
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remediation {
    pub description:  String,
    pub url:          Option<String>,
    pub auto_fixable: bool,
}
