// SPDX-License-Identifier: GPL-3.0
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use crate::engine::scanner::{scan_roots, ScanProgress};

// Global cancel flag — set to true when the user cancels a scan in progress.
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// Start a library scan. Emits progress events to the frontend.
#[tauri::command]
pub async fn scan_library(
    app:         AppHandle,
    project_id:  String,
    roots:       Vec<String>,
) -> Result<(), String> {
    CANCEL_FLAG.store(false, Ordering::Relaxed);
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();

    let root_paths: Vec<std::path::PathBuf> = roots.iter()
        .map(std::path::PathBuf::from)
        .collect();

    // Run scan in a blocking thread — walkdir is synchronous.
    tokio::task::spawn_blocking(move || {
        scan_roots(&root_paths, cancel_clone, |progress: ScanProgress| {
            let _ = app.emit("scan_progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get the current scan status for a project.
#[tauri::command]
pub async fn get_scan_status(project_id: String) -> Result<ScanStatusResponse, String> {
    Ok(ScanStatusResponse {
        is_running: false,
        project_id,
    })
}

/// Cancel an in-progress scan.
#[tauri::command]
pub async fn cancel_scan() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::Relaxed);
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusResponse {
    pub is_running:  bool,
    pub project_id: String,
}
