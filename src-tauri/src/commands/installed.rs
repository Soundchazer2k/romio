// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};
use crate::engine::shortcut_validator::{ShortcutValidationResult, validate_launch_command, validate_title_id};
use std::collections::HashMap;
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTitle { pub path: String, pub emulator: String, pub title_id: Option<String> }
#[tauri::command]
pub async fn validate_installed_titles(titles: Vec<InstalledTitle>) -> Result<Vec<ShortcutValidationResult>, String> {
    let results = titles.iter().map(|t| {
        let mut issues = vec![];
        if let Some(id) = &t.title_id {
            if let Some(issue) = validate_title_id(id, &t.emulator) {
                issues.push(issue);
            }
        }
        ShortcutValidationResult { shortcut_path: t.path.clone(), is_valid: issues.is_empty(), issues }
    }).collect();
    Ok(results)
}
#[tauri::command]
pub async fn validate_shortcut_content(command: String) -> Result<ShortcutValidationResult, String> {
    let env: HashMap<String, String> = std::env::vars().collect();
    let issues = validate_launch_command(&command, &env);
    Ok(ShortcutValidationResult { shortcut_path: command.clone(), is_valid: issues.is_empty(), issues })
}
#[tauri::command]
pub async fn generate_shortcuts(_titles: Vec<InstalledTitle>, _frontend: String) -> Result<Vec<String>, String> {
    Err("Shortcut generation not yet implemented".to_string())
}
