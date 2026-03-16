// SPDX-License-Identifier: GPL-3.0
use std::path::PathBuf;
use crate::models::bios::{BiosRule, BiosSystemResult};

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
pub async fn get_bios_status(project_id: String) -> Result<Vec<BiosSystemResult>, String> {
    // TODO: implement full project BIOS sweep
    // Returns cached results from the last scan if available
    Ok(vec![])
}
