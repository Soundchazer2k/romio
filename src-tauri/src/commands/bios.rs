// SPDX-License-Identifier: GPL-3.0
use std::path::PathBuf;
use crate::models::bios::{BiosRule, BiosSystemResult};
use crate::engine::bios_sweep;

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

#[tauri::command]
pub async fn revalidate_bios(project_id: String) -> Result<BiosStatusResponse, String> {
    let project = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let bios_root = project.bios_root
        .as_deref()
        .ok_or("BIOS path not configured")?;

    let frontend = resolve_primary_frontend(&project.target_frontends)?;

    let all_rules = crate::db::bios::load_all_rules()
        .map_err(|e| e.to_string())?;

    let config = bios_sweep::BiosSweepConfig {
        bios_root:      std::path::PathBuf::from(bios_root),
        frontend,
        emulator_prefs: project.emulator_prefs.clone(),
    };

    let results = bios_sweep::run_sweep(&config, &all_rules)
        .map_err(|e| e.to_string())?;

    crate::db::projects::update_bios_results(&project_id, results)
        .map_err(|e| e.to_string())?;

    // Re-read the persisted row so the returned timestamp matches what getProject returns.
    // This avoids a two-Utc::now() divergence between the response and the DB value.
    let updated = crate::db::projects::get(&project_id)
        .map_err(|e| e.to_string())?;

    let last_validated_at = updated.bios_last_validated_at
        .map(|dt| dt.to_rfc3339());

    Ok(BiosStatusResponse {
        configured:        true,
        validated:         true,
        results:           updated.bios_results.unwrap_or_default(),
        last_validated_at,
    })
}

#[tauri::command]
pub async fn set_bios_root(
    project_id: String,
    bios_root:  Option<String>,
) -> Result<(), String> {
    // Normalize: trim whitespace, empty string → None
    let normalized = bios_root.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
    });
    crate::db::projects::update_bios_root(&project_id, normalized.as_deref())
        .map_err(|e| e.to_string())
}
