// SPDX-License-Identifier: GPL-3.0
//! Format compatibility validation engine.
//! Checks ROM container formats against emulator support for the active frontend.

use anyhow::Result;
use std::path::Path;
use crate::models::format::{FormatRule, FormatCheckResult, FormatSupport, FormatFixAction, FormatFixType};
use crate::models::artifact::FormatCompatibilityState;

/// Check a single file's format compatibility against the loaded rules.
pub fn check_format(
    path: &Path,
    rules: &[FormatRule],
    system: &str,
    emulator: &str,
    frontend: &str,
) -> FormatCheckResult {
    let extension = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Find the most specific matching rule:
    // emulator+frontend > emulator-only > system-only
    let rule = rules.iter()
        .filter(|r| r.system == system && r.extension == extension)
        .find(|r| {
            let emu_match = r.emulator == emulator;
            let fe_match  = r.frontend.as_deref() == Some(frontend)
                         || r.frontend.is_none();
            emu_match && fe_match
        });

    match rule {
        None => FormatCheckResult {
            path: path.to_string_lossy().to_string(),
            extension,
            system: Some(system.to_string()),
            emulator: Some(emulator.to_string()),
            state: FormatCompatibilityState::Unknown,
            notes: Some("No compatibility rule found for this format/emulator combination.".to_string()),
            fix_action: None,
        },

        Some(r) => match &r.support {
            FormatSupport::Supported => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension,
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::Compatible,
                notes: r.notes.clone(),
                fix_action: None,
            },

            FormatSupport::Deprecated { replacement } => {
                let new_name = path.with_extension(replacement)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(String::from);

                FormatCheckResult {
                    path: path.to_string_lossy().to_string(),
                    extension: extension.clone(),
                    system: Some(system.to_string()),
                    emulator: Some(emulator.to_string()),
                    state: FormatCompatibilityState::FormatDeprecated,
                    notes: r.notes.clone(),
                    fix_action: Some(FormatFixAction {
                        action_type: FormatFixType::Rename,
                        description: format!(
                            "Rename .{} → .{} — content unchanged",
                            extension, replacement
                        ),
                        safe: true,
                        new_filename: new_name,
                    }),
                }
            }

            FormatSupport::Unsupported { reason } => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension: extension.clone(),
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::FormatIncompatible,
                notes: Some(reason.clone()),
                fix_action: Some(FormatFixAction {
                    action_type: FormatFixType::Redump,
                    description: format!(
                        ".{} is not supported by {}. Re-dump in a compatible format.",
                        extension, emulator
                    ),
                    safe: false,
                    new_filename: None,
                }),
            },

            FormatSupport::Conditional { condition } => FormatCheckResult {
                path: path.to_string_lossy().to_string(),
                extension,
                system: Some(system.to_string()),
                emulator: Some(emulator.to_string()),
                state: FormatCompatibilityState::Compatible,
                notes: Some(condition.clone()),
                fix_action: None,
            },
        }
    }
}
