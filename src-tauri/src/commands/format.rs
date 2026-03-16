// SPDX-License-Identifier: GPL-3.0
use crate::models::format::{FormatRule, FormatCheckResult};
#[tauri::command]
pub async fn check_format_compatibility(path: String, system: String, emulator: String, frontend: String) -> Result<FormatCheckResult, String> {
    let rules = crate::db::format::load_rules().map_err(|e| e.to_string())?;
    Ok(crate::engine::format_matrix::check_format(std::path::Path::new(&path), &rules, &system, &emulator, &frontend))
}
#[tauri::command]
pub async fn get_format_matrix() -> Result<Vec<FormatRule>, String> {
    crate::db::format::load_rules().map_err(|e| e.to_string())
}
