// SPDX-License-Identifier: GPL-3.0
use crate::engine::scummvm::{ScummVmGame, ScummVmReport};

/// Read-only: lists game folders and their pointer files.
#[tauri::command]
pub async fn detect_scummvm_games(root: String) -> Result<ScummVmReport, String> {
    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        crate::engine::scummvm::detect_games(std::path::Path::new(root.trim()))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn generate_pointer_files(_games: Vec<ScummVmGame>, _frontend: String) -> Result<Vec<String>, String> {
    Err("Pointer file generation not yet implemented".to_string())
}
