// SPDX-License-Identifier: GPL-3.0
// Tauri IPC command handlers.
// These are thin wrappers that call the engine and return serializable results.

pub mod project;
pub mod scan;
pub mod host_env;
pub mod bios;
pub mod format;
pub mod save;
pub mod multidisc;
pub mod scummvm;
pub mod installed;
pub mod export;
pub mod rollback;
pub mod emulator;
