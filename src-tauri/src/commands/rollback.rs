// SPDX-License-Identifier: GPL-3.0
use crate::models::validation::OperationLogEntry;
#[tauri::command]
pub async fn get_operation_log(project_id: String) -> Result<Vec<OperationLogEntry>, String> {
    Ok(vec![])
}
#[tauri::command]
pub async fn rollback_operation(operation_id: String) -> Result<(), String> {
    Err("Rollback not yet implemented".to_string())
}
