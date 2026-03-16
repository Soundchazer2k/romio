// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScummVmGame { pub path: String, pub detected_id: Option<String>, pub needs_pointer: bool }
#[tauri::command]
pub async fn detect_scummvm_games(root: String) -> Result<Vec<ScummVmGame>, String> {
    // TODO: implement ScummVM game directory detection
    Ok(vec![])
}
#[tauri::command]
pub async fn generate_pointer_files(games: Vec<ScummVmGame>, frontend: String) -> Result<Vec<String>, String> {
    // TODO: implement pointer/hook file generation per frontend
    Ok(vec![])
}
