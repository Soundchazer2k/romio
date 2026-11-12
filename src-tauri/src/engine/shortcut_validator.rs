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

    // Resolve and check the executable path at the start of the command
    let executable = extract_executable(command);
    if executable.is_none() && command.trim_start().starts_with('"') {
        issues.push(ShortcutIssue {
            issue_type: ShortcutIssueType::UnquotedSpacePath,
            description: "The command opens a quote and never closes it.".to_string(),
            value: None,
            fix: Some("Close the quote after the emulator's path.".to_string()),
        });
    }
    if let Some((exe_path, quoted)) = executable {
        let resolved = resolve_env_vars(&exe_path, env);
        // A folder of that name isn't an executable
        if !Path::new(&resolved).is_file() {
            // Unquoted, a path ends at its first space. If a file sits at a longer stretch of
            // the command, the quotes are what's missing.
            let whole = if quoted { None } else { unquoted_file_with_spaces(command, env) };
            issues.push(match whole {
                Some(path) => ShortcutIssue {
                    issue_type: ShortcutIssueType::UnquotedSpacePath,
                    description: format!("Executable path contains spaces but is not quoted: {path}"),
                    fix: Some(format!("Quote the path: \"{path}\"")),
                    value: Some(path),
                },
                None => ShortcutIssue {
                    issue_type: ShortcutIssueType::ExecutableNotFound,
                    description: format!("Executable not found: {resolved}"),
                    value: Some(resolved),
                    fix: Some(if quoted {
                        "Verify the emulator is installed at the configured path.".to_string()
                    } else {
                        "Verify the emulator is installed at the configured path. If the path has spaces, put it in quotes.".to_string()
                    }),
                },
            });
        }
    }

    issues
}

/// The name an emulator is shown by.
pub fn display_name(emulator: &str) -> &str {
    match emulator {
        "rpcs3"   => "RPCS3",
        "shadps4" => "shadPS4",
        "vita3k"  => "Vita3K",
        "cemu"    => "Cemu",
        other     => other,
    }
}

/// Validate title ID format for installed-title emulators, in any letter case.
/// RPCS3 and shadPS4: four letters and five digits; shadPS4 folders are written both as
/// CUSA00419 and CUSA-00419. Vita3K: nine letters or digits, as homebrew IDs have no digits rule.
/// The shape, not a prefix list: the emulators don't filter by prefix, and any list has gaps.
pub fn validate_title_id(title_id: &str, emulator: &str) -> Option<ShortcutIssue> {
    let example = match emulator {
        "rpcs3"   => "BLUS30443",
        "shadps4" => "CUSA00419",
        "vita3k"  => "PCSG00004",
        _         => return None, // Unknown emulator — skip validation
    };
    let valid = if emulator == "vita3k" {
        title_id.len() == 9 && title_id.chars().all(|c| c.is_ascii_alphanumeric())
    } else {
        let (prefix, digits) = title_id.split_at_checked(4).unwrap_or((title_id, ""));
        let digits = if emulator == "shadps4" { digits.strip_prefix('-').unwrap_or(digits) } else { digits };
        prefix.len() == 4 && prefix.chars().all(|c| c.is_ascii_alphabetic())
            && digits.len() == 5 && digits.chars().all(|c| c.is_ascii_digit())
    };
    if valid { return None; }

    let emulator = display_name(emulator);
    Some(ShortcutIssue {
        issue_type: ShortcutIssueType::TargetPathNotFound,
        description: format!(
            "{title_id} doesn't look like a title ID {emulator} uses, so {emulator} may not see this title."
        ),
        value: Some(title_id.to_string()),
        fix: Some(format!(
            "A title ID looks like {example}. If the folder was renamed, give it back its title ID."
        )),
    })
}

/// The executable at the start of a command, and whether it was quoted.
/// None for an empty command or a leading quote that is never closed.
fn extract_executable(command: &str) -> Option<(String, bool)> {
    let trimmed = command.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        return rest.find('"').map(|end| (rest[..end].to_string(), true));
    }
    trimmed.split_whitespace().next().map(|word| (word.to_string(), false))
}

/// The shortest start of an unquoted command that has a space in it and is a file on disk.
fn unquoted_file_with_spaces(command: &str, env: &HashMap<String, String>) -> Option<String> {
    let trimmed = command.trim();
    trimmed.match_indices(char::is_whitespace)
        .map(|(end, _)| end)
        .chain([trimmed.len()])
        .skip(1) // up to the first space is the plain first word
        .map(|end| &trimmed[..end])
        .find(|path| Path::new(&resolve_env_vars(path, env)).is_file())
        .map(String::from)
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
    fn quoting_is_judged_on_what_was_typed() {
        let env = HashMap::new();
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("with space");
        std::fs::create_dir(&folder).unwrap();
        let exe = folder.join("emu.exe");
        std::fs::write(&exe, b"").unwrap();
        let exe = exe.to_string_lossy().to_string();
        let kinds = |command: String| validate_launch_command(&command, &env).into_iter()
            .map(|i| (i.issue_type, i.value)).collect::<Vec<_>>();

        // Quoted path with spaces: nothing wrong, even with an .exe among the arguments
        assert!(kinds(format!("\"{exe}\" --no-gui other.exe")).is_empty());

        // Unquoted: flagged, and the whole path is named, not its first word
        let unquoted = kinds(format!("{exe} --no-gui"));
        assert!(matches!(unquoted.as_slice(), [(ShortcutIssueType::UnquotedSpacePath, Some(v))] if *v == exe), "{unquoted:?}");

        // A folder is not an executable, quoted or not
        let folder = folder.to_string_lossy().to_string();
        assert!(matches!(kinds(format!("\"{folder}\"")).as_slice(), [(ShortcutIssueType::ExecutableNotFound, _)]));

        // Nothing on disk: "not found" on the first word, never a guess at quoting
        let missing = kinds("nowhere --config other.exe".to_string());
        assert!(matches!(missing.as_slice(), [(ShortcutIssueType::ExecutableNotFound, Some(v))] if v == "nowhere"), "{missing:?}");

        // A quote that never closes is a problem, not a pass
        assert_eq!(kinds(format!("\"{exe} --no-gui")).len(), 1);
        assert!(kinds(String::new()).is_empty());
    }

    #[test]
    fn test_invalid_rpcs3_title_id() {
        let result = validate_title_id("Renamed Game", "rpcs3");
        assert!(result.is_some());
    }

    #[test]
    fn test_valid_rpcs3_title_id() {
        let result = validate_title_id("BLUS30443", "rpcs3");
        assert!(result.is_none());
    }

    #[test]
    fn test_valid_shadps4_title_id() {
        assert!(validate_title_id("CUSA-00419", "shadps4").is_none());
        assert!(validate_title_id("CUSA00419", "shadps4").is_none());
    }

    #[test]
    fn title_ids_need_a_known_prefix_and_five_digits() {
        assert!(validate_title_id("PCSE00120", "vita3k").is_none());
        assert!(validate_title_id("NPEA00123", "rpcs3").is_none());
        // Any prefix, any case; Vita homebrew IDs have no digits rule
        assert!(validate_title_id("MRTC00003", "rpcs3").is_none());
        assert!(validate_title_id("blus30443", "rpcs3").is_none());
        assert!(validate_title_id("VITASHELL", "vita3k").is_none());
        assert!(validate_title_id("PCSE0012", "vita3k").is_some());
        assert!(validate_title_id("BLUS3044", "rpcs3").is_some());
        assert!(validate_title_id("BLUS30443 copy", "rpcs3").is_some());
        assert!(validate_title_id("BLUS-30443", "rpcs3").is_some());
        assert!(validate_title_id("CUSA", "shadps4").is_some());
        assert!(validate_title_id("", "vita3k").is_some());
        // Not ASCII: must not panic on a split inside a character
        assert!(validate_title_id("ゲーム", "rpcs3").is_some());
        assert!(validate_title_id("anything", "xenia").is_none());
    }
}
