// SPDX-License-Identifier: GPL-3.0
use chrono::Utc;
use tauri::Manager;
use uuid::Uuid;
use crate::models::save::{MigrationBlocker, MigrationPlan, SaveCheckpoint, SaveRoot};
use crate::models::validation::OperationLogEntry;

#[tauri::command]
pub async fn discover_save_roots(frontend_root: String) -> Result<Vec<SaveRoot>, String> {
    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        let rules = crate::db::save::load_rules().map_err(|e| e.to_string())?;
        // appdata rules are Windows paths; never resolve them against an empty or foreign APPDATA
        let appdata = std::env::var_os("APPDATA")
            .filter(|v| cfg!(windows) && !v.is_empty())
            .map(std::path::PathBuf::from);
        let xdg_data = cfg!(target_os = "linux").then(xdg_data_home).flatten();
        let anchors = crate::engine::save_registry::SaveAnchors {
            appdata:  appdata.as_deref(),
            xdg_data: xdg_data.as_deref(),
        };
        Ok(crate::engine::save_registry::discover_save_roots(
            std::path::Path::new(frontend_root.trim()),
            &anchors,
            &rules,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// $XDG_DATA_HOME if it's set to an absolute path (the spec says ignore anything else),
/// otherwise ~/.local/share.
fn xdg_data_home() -> Option<std::path::PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|h| !h.is_empty())
                .map(|h| std::path::PathBuf::from(h).join(".local").join("share"))
        })
}

#[tauri::command]
pub async fn check_migration_needed(frontend_root: String) -> Result<bool, String> {
    let roots = discover_save_roots(frontend_root).await?;
    Ok(roots
        .iter()
        .any(|r| r.migration_state == crate::models::save::SaveMigrationState::MigrationNeeded))
}

#[tauri::command]
pub async fn create_migration_plan(
    project_id:  String,
    source:      String,
    destination: String,
    emulator:    String,
) -> Result<MigrationPlan, String> {
    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        if project_id.is_empty() {
            return Err("project_id is required".to_string());
        }
        crate::db::projects::get(&project_id)
            .map_err(|e| format!("project not found: {e}"))?;
        crate::engine::save_registry::build_migration_plan(
            std::path::Path::new(&source),
            std::path::Path::new(&destination),
            &emulator,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_save_checkpoint(
    project_id: String,
    source:     String,
    emulator:   String,
    app_handle: tauri::AppHandle,
) -> Result<SaveCheckpoint, String> {
    if project_id.is_empty() {
        return Err("project_id is required".to_string());
    }
    crate::db::projects::get(&project_id)
        .map_err(|e| format!("project not found: {e}"))?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;

    // Off the async workers, so a stalled drive can't starve every other command
    tokio::task::spawn_blocking(move || {
        // Pure engine call: creates zip, returns SaveCheckpoint (no DB writes)
        let checkpoint = crate::engine::save_checkpoint::create_checkpoint(
            &project_id,
            std::path::Path::new(&source),
            &emulator,
            &app_data_dir,
        )
        .map_err(|e| e.to_string())?;

        let log_entry = OperationLogEntry {
            id:             Uuid::new_v4(),
            project_id:     project_id.clone(),
            operation:      "create_checkpoint".to_string(),
            description:    format!(
                "Created checkpoint of {} ({} files, {} bytes)",
                source, checkpoint.file_count, checkpoint.size_bytes
            ),
            affected_paths: vec![source.clone(), checkpoint.archive_path.clone()],
            reversible:     false,
            rolled_back:    false,
            created_at:     Utc::now(),
        };

        // Atomically persist checkpoint row + log entry
        let archive_path = checkpoint.archive_path.clone();
        if let Err(e) = crate::db::with_transaction(|tx| {
            crate::db::checkpoints::insert_tx(tx, &checkpoint)?;
            crate::db::operation_log::insert_tx(tx, &log_entry)?;
            Ok(())
        }) {
            // Transaction failed: delete archive so no orphan artifact exists
            let _ = std::fs::remove_file(&archive_path);
            return Err(format!("Failed to persist checkpoint: {e}"));
        }

        Ok(checkpoint)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_checkpoints(project_id: String) -> Result<Vec<SaveCheckpoint>, String> {
    crate::db::checkpoints::list(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_migration(
    _project_id: String,
    _plan:       MigrationPlan,
) -> Result<(), MigrationBlocker> {
    Err(MigrationBlocker::CheckpointRequired)
}
