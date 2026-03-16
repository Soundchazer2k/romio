// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDiscSet { pub name: String, pub discs: Vec<String> }
#[tauri::command]
pub async fn detect_multidisc_sets(root: String) -> Result<Vec<MultiDiscSet>, String> {
    // TODO: implement naming heuristics + CUE sheet parsing
    Ok(vec![])
}
#[tauri::command]
pub async fn generate_m3u(set: MultiDiscSet, output_dir: String, frontend: String) -> Result<String, String> {
    // TODO: implement M3U generation with frontend-specific path rules
    Err("M3U generation not yet implemented".to_string())
}
