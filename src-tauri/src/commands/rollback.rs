// SPDX-License-Identifier: GPL-3.0
use crate::models::validation::OperationLogEntry;

#[tauri::command]
pub async fn get_operation_log(project_id: String) -> Result<Vec<OperationLogEntry>, String> {
    crate::db::operation_log::list(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_operation(_operation_id: String) -> Result<(), String> {
    Err("Rollback execution not yet implemented — log entry preserved".to_string())
}
