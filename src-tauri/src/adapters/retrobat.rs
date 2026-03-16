// SPDX-License-Identifier: GPL-3.0
//! RetroBat frontend adapter.
//! Key concern: save-path migrations between RetroBat major versions.
use super::FrontendAdapter;
pub struct RetroBatAdapter;
impl FrontendAdapter for RetroBatAdapter {
    fn frontend_id(&self)   -> &'static str { "retrobat" }
    fn frontend_name(&self) -> &'static str { "RetroBat" }
    fn validate_bios_path(&self, system: &str, emulator: &str) -> String {
        match emulator {
            "lr-kronos"   => "bios/kronos/".to_string(),
            "lr-flycast"  => "bios/dc/".to_string(),
            _             => "bios/".to_string(),
        }
    }
    fn validate_rom_path(&self, system: &str) -> String { format!("roms/{}/", system) }
}
