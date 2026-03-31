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
/// On completion, persists artifacts and updates project scan stats.
#[tauri::command]
pub async fn scan_library(
    app:        AppHandle,
    project_id: String,
    roots:      Vec<String>,
) -> Result<(), String> {
    cancel_flag().store(false, Ordering::Relaxed);
    SCAN_RUNNING.store(true, Ordering::Relaxed);

    let cancel     = Arc::clone(cancel_flag());
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

    let artifacts = result.map_err(|e| e.to_string())?;

    // If the scan was cancelled, discard partial results — do not persist.
    if cancel_flag().load(Ordering::Relaxed) {
        return Ok(());
    }

    // Persist artifacts (replaces any prior scan for this project)
    crate::db::artifacts::save_batch(&project_id, &artifacts)
        .map_err(|e| format!("Failed to persist artifacts: {e}"))?;

    // Derive stats and stamp last_scanned_at
    let stats = crate::engine::scanner::derive_scan_stats(&artifacts);
    crate::db::projects::update_scan_completion(&project_id, stats)
        .map_err(|e| format!("Failed to update scan stats: {e}"))?;

    // Best-effort BIOS sweep — failure does not fail the scan.
    // DB note: get() and load_all_rules() each acquire and release the mutex independently.
    // Do NOT nest them inside each other or inside another with_conn closure.
    let project_for_bios = crate::db::projects::get(&project_id);
    if let Ok(project) = project_for_bios {
        if let Some(ref bios_root) = project.bios_root {
            match crate::commands::bios::resolve_primary_frontend(&project.target_frontends) {
                Ok(frontend) => {
                    match crate::db::bios::load_all_rules() {
                        Ok(all_rules) => {
                            let config = crate::engine::bios_sweep::BiosSweepConfig {
                                bios_root:      std::path::PathBuf::from(bios_root),
                                frontend:       frontend.clone(),
                                emulator_prefs: project.emulator_prefs.clone(),
                            };
                            match crate::engine::bios_sweep::run_sweep(&config, &all_rules) {
                                Ok(results) => {
                                    let _ = crate::db::projects::update_bios_results(
                                        &project_id, results
                                    );
                                }
                                Err(e) => eprintln!(
                                    "[scan] BIOS sweep failed \
                                     project_id={} bios_root={} frontend={}: {}",
                                    project_id, bios_root, frontend, e
                                ),
                            }
                        }
                        Err(e) => eprintln!("[scan] BIOS rules load failed: {}", e),
                    }
                }
                Err(e) => eprintln!("[scan] BIOS sweep skipped: {}", e),
            }
        }
    }

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
