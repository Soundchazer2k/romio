// SPDX-License-Identifier: GPL-3.0
use crate::engine::host_checker;
use crate::models::host::HostEnvironmentReport;

/// Run host environment pre-flight checks.
/// Called before the main scan. Results surface in the pre-flight panel.
#[tauri::command]
pub async fn check_host_environment() -> Result<HostEnvironmentReport, String> {
    Ok(host_checker::check_host_environment())
}
