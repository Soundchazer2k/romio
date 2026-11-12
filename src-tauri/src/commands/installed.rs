// SPDX-License-Identifier: GPL-3.0
use crate::engine::installed_titles::TitleCheck;
use crate::engine::shortcut_validator::{ShortcutValidationResult, validate_launch_command};
use std::collections::HashMap;

/// Read-only: checks each title folder's name and required files.
#[tauri::command]
pub async fn check_installed_titles(dir: String, emulator: String) -> Result<Vec<TitleCheck>, String> {
    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        crate::engine::installed_titles::check_titles(std::path::Path::new(dir.trim()), &emulator)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn validate_shortcut_content(command: String) -> Result<ShortcutValidationResult, String> {
    // Off the async workers: it checks that the executable exists
    tokio::task::spawn_blocking(move || {
        let env: HashMap<String, String> = std::env::vars().collect();
        let issues = validate_launch_command(&command, &env);
        ShortcutValidationResult { shortcut_path: command.clone(), is_valid: issues.is_empty(), issues }
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn generate_shortcuts(_titles: Vec<TitleCheck>, _frontend: String) -> Result<Vec<String>, String> {
    Err("Shortcut generation not yet implemented".to_string())
}
