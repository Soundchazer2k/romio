// SPDX-License-Identifier: GPL-3.0
use std::path::PathBuf;
use crate::models::bios::{BiosRule, BiosSystemResult};

// Note: `use crate::engine::bios_sweep` is NOT added here — it's only needed
// in Task 7 when revalidate_bios is added. Adding unused imports causes warnings
// (or errors under deny(warnings)).

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosStatusResponse {
    pub configured:        bool,
    pub validated:         bool,
    pub results:           Vec<crate::models::bios::BiosSystemResult>,
    pub last_validated_at: Option<String>,
}

/// Returns the primary frontend for BIOS validation.
/// BIOS sweep targets one frontend — the first of the project's target_frontends.
pub fn resolve_primary_frontend(frontends: &[String]) -> Result<String, String> {
    frontends.first()
        .cloned()
        .ok_or_else(|| "project has no target frontends configured".to_string())
}

/// Get all BIOS rules for a given system from the embedded database.
#[tauri::command]
pub async fn get_bios_rules(system: String) -> Result<Vec<BiosRule>, String> {
    let rules = crate::db::bios::load_rules_for_system(&system)
        .map_err(|e| e.to_string())?;
    Ok(rules)
}

/// Validate BIOS for a system against a bios directory.
#[tauri::command]
pub async fn validate_bios(
    system:    String,
    bios_root: String,
    frontend:  String,
    emulator:  String,
) -> Result<BiosSystemResult, String> {
    let rules = crate::db::bios::load_rules_for_system(&system)
        .map_err(|e| e.to_string())?;
    let root = PathBuf::from(&bios_root);
    crate::engine::bios_validator::validate_system_bios(&root, &rules, &frontend, &emulator)
        .map_err(|e| e.to_string())
}

/// Get the current BIOS validation status for all systems in a project.
#[tauri::command]
pub async fn get_bios_status(project_id: String) -> Result<BiosStatusResponse, String> {
    let project = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let configured = project.bios_root.is_some();
    let validated  = project.bios_results.is_some();
    let results    = project.bios_results.unwrap_or_default();
    let last_validated_at = project.bios_last_validated_at
        .map(|dt| dt.to_rfc3339());

    Ok(BiosStatusResponse { configured, validated, results, last_validated_at })
}
