// SPDX-License-Identifier: GPL-3.0
//! Per-frontend export adapters.
//! Each adapter translates the canonical project model into
//! the artifact set expected by a specific frontend.

pub mod esde;
pub mod retrobat;
pub mod launchbox;
pub mod batocera;
pub mod playnite;

/// Trait all frontend adapters must implement.
pub trait FrontendAdapter {
    fn frontend_id(&self) -> &'static str;
    fn frontend_name(&self) -> &'static str;
    fn validate_bios_path(&self, system: &str, emulator: &str) -> String;
    fn validate_rom_path(&self, system: &str) -> String;
}
