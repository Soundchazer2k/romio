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
