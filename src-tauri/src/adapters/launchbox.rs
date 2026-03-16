// SPDX-License-Identifier: GPL-3.0
//! LaunchBox frontend adapter.
use super::FrontendAdapter;
pub struct LaunchBoxAdapter;
impl FrontendAdapter for LaunchBoxAdapter {
    fn frontend_id(&self)   -> &'static str { "launchbox" }
    fn frontend_name(&self) -> &'static str { "LaunchBox" }
    fn validate_bios_path(&self, _system: &str, emulator: &str) -> String {
        match emulator {
            "lr-kronos"  => "bios/kronos/".to_string(),
            "lr-flycast" => "bios/dc/".to_string(),
            _            => "bios/".to_string(),
        }
    }
    fn validate_rom_path(&self, system: &str) -> String { format!("roms/{}/", system) }
}
