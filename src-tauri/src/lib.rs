// SPDX-License-Identifier: GPL-3.0
// Romio — Your retro library's best friend.

pub mod commands;
pub mod db;
pub mod engine;
pub mod adapters;
pub mod models;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize the database on first run
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir)?;
            db::init(&app_dir)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project management
            commands::project::create_project,
            commands::project::open_project,
            commands::project::list_projects,
            commands::project::get_project,

            // Library scan
            commands::scan::scan_library,
            commands::scan::get_scan_status,
            commands::scan::cancel_scan,

            // Host environment / pre-flight
            commands::host_env::check_host_environment,

            // BIOS validation
            commands::bios::validate_bios,
            commands::bios::get_bios_rules,
            commands::bios::get_bios_status,
            commands::bios::revalidate_bios,
            commands::bios::set_bios_root,

            // Format compatibility
            commands::format::check_format_compatibility,
            commands::format::get_format_matrix,

            // Save migration
            commands::save::discover_save_roots,
            commands::save::check_migration_needed,
            commands::save::create_migration_plan,
            commands::save::execute_migration,
            commands::save::create_save_checkpoint,

            // Multi-disc
            commands::multidisc::detect_multidisc_sets,
            commands::multidisc::generate_m3u,

            // ScummVM
            commands::scummvm::detect_scummvm_games,
            commands::scummvm::generate_pointer_files,

            // Installed titles
            commands::installed::validate_installed_titles,
            commands::installed::validate_shortcut_content,
            commands::installed::generate_shortcuts,

            // Export
            commands::export::get_supported_frontends,
            commands::export::plan_export,
            commands::export::execute_export,
            commands::export::dry_run_export,

            // Rollback / operation log
            commands::rollback::get_operation_log,
            commands::rollback::rollback_operation,

            // Emulator matrix
            commands::emulator::get_emulator_matrix,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Romio");
}
