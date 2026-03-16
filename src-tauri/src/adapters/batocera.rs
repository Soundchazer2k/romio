// SPDX-License-Identifier: GPL-3.0
//! Batocera export adapter.
use super::FrontendAdapter;
pub struct BatoceraAdapter;
impl FrontendAdapter for BatoceraAdapter {
    fn frontend_id(&self)   -> &'static str { "batocera" }
    fn frontend_name(&self) -> &'static str { "Batocera" }
    fn validate_bios_path(&self, _system: &str, _emulator: &str) -> String { "bios/".to_string() }
    fn validate_rom_path(&self, system: &str) -> String { format!("roms/{}/", system) }
}
