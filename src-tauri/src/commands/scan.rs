// SPDX-License-Identifier: GPL-3.0
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use crate::engine::scanner::{scan_roots, ScanProgress};

/// Shared cancel Arc — same flag the running scan and cancel_scan() both touch.
fn cancel_flag() -> &'static Arc<AtomicBool> {
    static FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    FLAG.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// True while a scan is executing.
static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start a library scan. Emits progress events to the frontend.
#[tauri::command]
pub async fn scan_library(
    app:        AppHandle,
    project_id: String,
    roots:      Vec<String>,
) -> Result<(), String> {
    cancel_flag().store(false, Ordering::Relaxed);
    SCAN_RUNNING.store(true, Ordering::Relaxed);

    let cancel = Arc::clone(cancel_flag());
    let root_paths: Vec<std::path::PathBuf> =
        roots.iter().map(std::path::PathBuf::from).collect();

    let result = tokio::task::spawn_blocking(move || {
        scan_roots(&root_paths, cancel, |progress: ScanProgress| {
            let _ = app.emit("scan_progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    SCAN_RUNNING.store(false, Ordering::Relaxed);

    result.map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the current scan status for a project.
#[tauri::command]
pub async fn get_scan_status(project_id: String) -> Result<ScanStatusResponse, String> {
    Ok(ScanStatusResponse {
        is_running: SCAN_RUNNING.load(Ordering::Relaxed),
        project_id,
    })
}

/// Cancel an in-progress scan.
#[tauri::command]
pub async fn cancel_scan() -> Result<(), String> {
    cancel_flag().store(true, Ordering::Relaxed);
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusResponse {
    pub is_running:  bool,
    pub project_id: String,
}
