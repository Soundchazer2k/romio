// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::save::SavePathRule;

pub fn load_rules() -> Result<Vec<SavePathRule>> {
    let json = include_str!("../../data/save_paths.json");
    let rules: Vec<SavePathRule> = serde_json::from_str(json)?;
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_move_saves_somewhere_new() {
        // old == new makes discover_save_roots report a false ConflictDetected
        let rules = load_rules().expect("save paths should parse");
        assert!(!rules.is_empty(), "save_paths.json has no rules");
        for rule in rules {
            assert_ne!(rule.old_path_pattern, rule.new_path_pattern, "rule for {}", rule.emulator);
            // discover_save_roots silently skips rules with an anchor it doesn't know
            assert!(
                matches!(rule.anchor.as_deref(), None | Some("appdata")),
                "unknown anchor for {}", rule.emulator
            );
        }
    }
}
