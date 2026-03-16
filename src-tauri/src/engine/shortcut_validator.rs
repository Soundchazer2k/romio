// SPDX-License-Identifier: GPL-3.0
//! Shortcut content validity validation.
//! Detects unexpanded variables, unresolved paths, and quoting errors
//! in generated launch commands and shortcut files.

use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// Known variable tokens used in generated shortcuts.
/// These must resolve to actual values — if they remain as literals, the shortcut is broken.
const KNOWN_VARIABLE_TOKENS: &[&str] = &[
    "%RPCS3_GAMEID%",
    "%EMULATORPATH%",
    "%ROMPATH%",
    "%SAVESPATH%",
    "%BIOSDIR%",
    "{GAMEID}",
    "{ROM}",
    "{EMULATOR}",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutValidationResult {
    pub shortcut_path:     String,
    pub is_valid:          bool,
    pub issues:            Vec<ShortcutIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutIssue {
    pub issue_type:  ShortcutIssueType,
    pub description: String,
    pub value:       Option<String>,
    pub fix:         Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutIssueType {
    UnexpandedVariable,
    ExecutableNotFound,
    TargetPathNotFound,
    UnquotedSpacePath,
    SeparatorMismatch,
}

/// Validate a launch command string for variable expansion and path validity.
pub fn validate_launch_command(
    command: &str,
    env: &HashMap<String, String>,
) -> Vec<ShortcutIssue> {
    let mut issues = Vec::new();

    // Check for unexpanded variable tokens
    for token in KNOWN_VARIABLE_TOKENS {
        if command.contains(token) {
            issues.push(ShortcutIssue {
                issue_type: ShortcutIssueType::UnexpandedVariable,
                description: format!(
                    "Launch command contains unexpanded variable: {}. This shortcut will fail silently at runtime.",
                    token
                ),
                value: Some(token.to_string()),
                fix: Some(format!("Regenerate the shortcut — {} must be resolved before the shortcut is written.", token)),
            });
        }
    }

    // Resolve and check executable path (first token in command)
    if let Some(exe_path) = extract_executable(command) {
        let resolved = resolve_env_vars(&exe_path, env);
        if !Path::new(&resolved).exists() {
            issues.push(ShortcutIssue {
                issue_type: ShortcutIssueType::ExecutableNotFound,
                description: format!("Executable not found: {}", resolved),
                value: Some(resolved),
                fix: Some("Verify the emulator is installed at the configured path.".to_string()),
            });
        }
        // Check quoting
        if exe_path.contains(' ') && !exe_path.starts_with('"') {
            issues.push(ShortcutIssue {
                issue_type: ShortcutIssueType::UnquotedSpacePath,
                description: format!("Executable path contains spaces but is not quoted: {}", exe_path),
                value: Some(exe_path.clone()),
                fix: Some(format!("Quote the path: \"{}\"", exe_path)),
            });
        }
    }

    issues
}

/// Validate title ID format for installed-title emulators.
pub fn validate_title_id(title_id: &str, emulator: &str) -> Option<ShortcutIssue> {
    let valid = match emulator {
        "rpcs3"  => title_id.starts_with("BLES") || title_id.starts_with("BLUS")
                 || title_id.starts_with("BCUS") || title_id.starts_with("NPUB")
                 || title_id.starts_with("NPEB"),
        "shadps4" => title_id.starts_with("CUSA-") && title_id.len() == 10,
        "vita3k"  => title_id.starts_with("PCSG") || title_id.starts_with("PCSB")
                  || title_id.starts_with("PCSA") || title_id.starts_with("PCSD"),
        _        => true, // Unknown emulator — skip validation
    };

    if !valid {
        Some(ShortcutIssue {
            issue_type: ShortcutIssueType::TargetPathNotFound,
            description: format!(
                "Title ID '{}' does not match expected format for {}. The emulator may not recognize this title.",
                title_id, emulator
            ),
            value: Some(title_id.to_string()),
            fix: Some(format!(
                "Verify the title ID matches the emulator's naming convention. See Romio documentation for {} title ID formats.",
                emulator
            )),
        })
    } else {
        None
    }
}

fn extract_executable(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.starts_with('"') {
        // Quoted path — find closing quote
        trimmed.find('"').and_then(|_| {
            trimmed[1..].find('"').map(|end| trimmed[1..=end].to_string())
        })
    } else {
        // Unquoted — first whitespace-delimited token
        trimmed.split_whitespace().next().map(String::from)
    }
}

fn resolve_env_vars(s: &str, env: &HashMap<String, String>) -> String {
    let mut result = s.to_string();
    for (key, val) in env {
        result = result.replace(&format!("%{}%", key), val);
        result = result.replace(&format!("${}", key), val);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unexpanded_rpcs3_gameid() {
        let env = HashMap::new();
        let issues = validate_launch_command(
            r"C:\emulators\rpcs3.exe --no-gui %RPCS3_GAMEID%:NPUB30605",
            &env,
        );
        assert!(issues.iter().any(|i| matches!(i.issue_type, ShortcutIssueType::UnexpandedVariable)));
    }

    #[test]
    fn test_valid_command_no_issues_for_variables() {
        let env = HashMap::new();
        let issues = validate_launch_command(
            r"C:\emulators\duckstation.exe C:\roms\ps1\game.chd",
            &env,
        );
        // May still have ExecutableNotFound but should have no unexpanded variables
        assert!(!issues.iter().any(|i| matches!(i.issue_type, ShortcutIssueType::UnexpandedVariable)));
    }

    #[test]
    fn test_invalid_rpcs3_title_id() {
        let result = validate_title_id("GAME12345", "rpcs3");
        assert!(result.is_some());
    }

    #[test]
    fn test_valid_rpcs3_title_id() {
        let result = validate_title_id("BLUS30443", "rpcs3");
        assert!(result.is_none());
    }

    #[test]
    fn test_valid_shadps4_title_id() {
        let result = validate_title_id("CUSA-00419", "shadps4");
        assert!(result.is_none());
    }
}
