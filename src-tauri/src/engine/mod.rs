// SPDX-License-Identifier: GPL-3.0
// Core rules engine — no Tauri dependencies in this module.
// All logic here is pure Rust and fully testable in isolation.

pub mod hash;
pub mod bios_validator;
pub mod format_matrix;
pub mod path_normalizer;
pub mod save_registry;
pub mod host_checker;
pub mod scanner;
pub mod shortcut_validator;
pub mod bios_sweep;
pub mod save_checkpoint;
pub mod multidisc;
pub mod scummvm;
pub mod installed_titles;

/// The frontend whose rules apply. EmuDeck and RetroDECK install ES-DE and keep its
/// folder layout, so they share ES-DE's rules.
pub fn rules_frontend(frontend: &str) -> &str {
    match frontend {
        "emudeck" | "retrodeck" => "esde",
        other => other,
    }
}
