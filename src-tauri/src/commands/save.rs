// SPDX-License-Identifier: GPL-3.0
use crate::models::save::{SaveRoot, MigrationPlan};
#[tauri::command]
pub async fn discover_save_roots(frontend_root: String) -> Result<Vec<SaveRoot>, String> {
    let rules = crate::db::save::load_rules().map_err(|e| e.to_string())?;
    Ok(crate::engine::save_registry::discover_save_roots(std::path::Path::new(&frontend_root), &rules))
}
#[tauri::command]
pub async fn check_migration_needed(frontend_root: String) -> Result<bool, String> {
    let roots = discover_save_roots(frontend_root).await?;
    Ok(roots.iter().any(|r| r.migration_state == crate::models::save::SaveMigrationState::MigrationNeeded))
}
#[tauri::command]
pub async fn create_migration_plan(source: String, destination: String, emulator: String) -> Result<MigrationPlan, String> {
    crate::engine::save_registry::build_migration_plan(std::path::Path::new(&source), std::path::Path::new(&destination), &emulator)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn execute_migration(_plan: MigrationPlan) -> Result<(), String> {
    // TODO: implement — requires backup step completion gate
    Err("Migration execution not yet implemented. Backup step must be confirmed first.".to_string())
}
#[tauri::command]
pub async fn create_save_checkpoint(source: String, emulator: String) -> Result<crate::models::save::SaveCheckpoint, String> {
    Err("Save checkpoint not yet implemented".to_string())
}
