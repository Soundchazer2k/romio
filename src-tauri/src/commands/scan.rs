// SPDX-License-Identifier: GPL-3.0
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use crate::engine::scanner::{scan_roots, ScanPhase, ScanProgress};
use crate::models::artifact::Artifact;

/// Shared cancel Arc — same flag the running scan and cancel_scan() both touch.
fn cancel_flag() -> &'static Arc<AtomicBool> {
    static FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    FLAG.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// True while a scan is executing.
static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Save a finished scan and stamp the project, announcing the save first because it takes a
/// while on large libraries. A cancelled scan saves nothing and returns false.
fn persist_scan(
    project_id:  &str,
    artifacts:   &[Artifact],
    cancel:      &AtomicBool,
    on_progress: impl Fn(ScanProgress),
) -> Result<bool, String> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(false);
    }

    on_progress(ScanProgress {
        files_scanned: artifacts.len() as u64,
        files_total:   None,
        current_path:  String::new(),
        phase:         ScanPhase::Saving,
    });

    // Persist artifacts (replaces any prior scan for this project)
    crate::db::artifacts::save_batch(project_id, artifacts)
        .map_err(|e| format!("Failed to persist artifacts: {e}"))?;

    // Derive stats and stamp last_scanned_at
    let stats = crate::engine::scanner::derive_scan_stats(artifacts);
    crate::db::projects::update_scan_completion(project_id, stats)
        .map_err(|e| format!("Failed to update scan stats: {e}"))?;

    Ok(true)
}

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

    let walk_app = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        scan_roots(&root_paths, cancel, |progress: ScanProgress| {
            let _ = walk_app.emit("scan_progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    SCAN_RUNNING.store(false, Ordering::Relaxed);

    let artifacts = result.map_err(|e| e.to_string())?;

    // If the scan was cancelled, discard partial results — do not persist.
    let saved = persist_scan(&project_id, &artifacts, cancel_flag(), |progress| {
        let _ = app.emit("scan_progress", &progress);
    })?;
    if !saved {
        return Ok(());
    }

    // Best-effort BIOS sweep — failure does not fail the scan.
    // DB note: get() and load_all_rules() each acquire and release the mutex independently.
    // Do NOT nest them inside each other or inside another with_conn closure.
    // Off the async workers, so a stalled BIOS drive can't starve every other command
    let _ = tokio::task::spawn_blocking(move || {
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
                                        if let Err(e) = crate::db::projects::update_bios_results(
                                            &project_id, results
                                        ) {
                                            eprintln!(
                                                "[scan] BIOS results persist failed \
                                                 project_id={} bios_root={} frontend={}: {}",
                                                project_id, bios_root, frontend, e
                                            );
                                        }
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
    })
    .await;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::artifact::{
        ArtifactType, BiosValidationState, ExportStatus, FormatCompatibilityState, ScanVisibility,
    };
    use serial_test::serial;
    use std::cell::RefCell;
    use tempfile::TempDir;

    fn artifact() -> Artifact {
        Artifact {
            id:                    uuid::Uuid::new_v4(),
            artifact_type:         ArtifactType::Rom,
            source_path:           "/test/file.zip".into(),
            normalized_path:       "/test/file.zip".into(),
            md5_hash:              None,
            file_size:             Some(1024),
            detected_system:       None,
            detected_format:       Some("zip".into()),
            bios_state:            BiosValidationState::NotApplicable,
            format_state:          FormatCompatibilityState::NotApplicable,
            frontend_tags:         vec![],
            scan_visibility:       ScanVisibility::Visible,
            title_id:              None,
            export_status:         ExportStatus::NotExported,
            validation_findings:   vec![],
            save_root_association: None,
            notes:                 None,
            scanned_at:            chrono::Utc::now(),
        }
    }

    fn new_project(dir: &TempDir) -> String {
        crate::db::init(dir.path()).unwrap();
        crate::db::projects::create(crate::models::project::CreateProjectRequest {
            name:             "test".to_string(),
            library_roots:    vec![],
            target_frontends: vec![],
        }).unwrap().id.to_string()
    }

    fn saved_rows(project_id: &str) -> i64 {
        crate::db::with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT COUNT(*) FROM artifacts WHERE project_id = ?1",
                rusqlite::params![project_id],
                |row| row.get(0),
            )?)
        }).unwrap()
    }

    #[test]
    #[serial]
    fn announces_saving_before_it_writes_anything() {
        let dir = TempDir::new().unwrap();
        let project = new_project(&dir);
        let rows_when_announced = RefCell::new(None);
        let phase_sent = RefCell::new(serde_json::Value::Null);
        let count_sent = RefCell::new(0);

        let saved = persist_scan(&project, &[artifact(), artifact()], &AtomicBool::new(false), |p| {
            *rows_when_announced.borrow_mut() = Some(saved_rows(&project));
            *phase_sent.borrow_mut() = serde_json::to_value(&p.phase).unwrap();
            *count_sent.borrow_mut() = p.files_scanned;
        }).unwrap();

        assert!(saved);
        assert_eq!(rows_when_announced.into_inner(), Some(0));
        // src/types/index.ts ScanPhase has to match this name
        assert_eq!(phase_sent.into_inner(), "saving");
        assert_eq!(count_sent.into_inner(), 2);
        assert_eq!(saved_rows(&project), 2);
        assert!(crate::db::projects::get(&project).unwrap().last_scanned_at.is_some());
    }

    #[test]
    #[serial]
    fn cancelled_scan_saves_nothing_and_never_says_saving() {
        let dir = TempDir::new().unwrap();
        let project = new_project(&dir);
        crate::db::artifacts::save_batch(&project, &[artifact()]).unwrap();
        let events = RefCell::new(0);

        let saved = persist_scan(&project, &[artifact(), artifact()], &AtomicBool::new(true), |_| {
            *events.borrow_mut() += 1;
        }).unwrap();

        assert!(!saved);
        assert_eq!(events.into_inner(), 0);
        assert_eq!(saved_rows(&project), 1);
        assert!(crate::db::projects::get(&project).unwrap().last_scanned_at.is_none());
    }

    #[test]
    #[serial]
    fn failed_save_reports_the_error_and_keeps_the_previous_scan() {
        let dir = TempDir::new().unwrap();
        let project = new_project(&dir);
        let original = artifact();
        crate::db::artifacts::save_batch(&project, std::slice::from_ref(&original)).unwrap();

        // The repeated id fails on the second insert
        let repeated = artifact();
        let result = persist_scan(&project, &[repeated.clone(), repeated], &AtomicBool::new(false), |_| {});

        assert!(result.unwrap_err().contains("Failed to persist artifacts"));
        assert_eq!(saved_rows(&project), 1);
        let surviving_id: String = crate::db::with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM artifacts WHERE project_id = ?1",
                rusqlite::params![project],
                |row| row.get(0),
            )?)
        }).unwrap();
        assert_eq!(surviving_id, original.id.to_string());
        assert!(crate::db::projects::get(&project).unwrap().last_scanned_at.is_none());
    }
}
