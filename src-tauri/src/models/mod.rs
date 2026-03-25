// SPDX-License-Identifier: GPL-3.0
// Shared data models — these types cross the Tauri IPC bridge via serde.
// TypeScript equivalents live in src/types/

pub mod artifact;
pub mod bios;
pub mod validation;
pub mod project;
pub mod save;
pub mod host;
pub mod format;
pub mod emulator;
