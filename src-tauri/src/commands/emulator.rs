// SPDX-License-Identifier: GPL-3.0
use crate::models::emulator::EmulatorMatrixEntry;

#[tauri::command]
pub async fn get_emulator_matrix() -> Result<Vec<EmulatorMatrixEntry>, String> {
    crate::db::emulator::load_emulator_matrix().map_err(|e| e.to_string())
}
