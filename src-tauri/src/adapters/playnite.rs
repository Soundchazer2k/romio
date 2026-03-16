// SPDX-License-Identifier: GPL-3.0
//! Playnite export adapter.
use super::FrontendAdapter;
pub struct PlayniteAdapter;
impl FrontendAdapter for PlayniteAdapter {
    fn frontend_id(&self)   -> &'static str { "playnite" }
    fn frontend_name(&self) -> &'static str { "Playnite" }
    fn validate_bios_path(&self, _system: &str, _emulator: &str) -> String { "bios/".to_string() }
    fn validate_rom_path(&self, system: &str) -> String { format!("roms/{}/", system) }
}
