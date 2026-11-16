// SPDX-License-Identifier: GPL-3.0
use crate::engine::multidisc::MultiDiscSet;

/// Read-only: finds sets and reports on their playlists.
#[tauri::command]
pub async fn detect_multidisc_sets(root: String) -> Result<Vec<MultiDiscSet>, String> {
    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        crate::engine::multidisc::detect_sets(std::path::Path::new(root.trim()))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn generate_m3u(_set: MultiDiscSet, _output_dir: String, _frontend: String) -> Result<String, String> {
    // TODO: implement M3U generation with frontend-specific path rules
    Err("M3U generation not yet implemented".to_string())
}
