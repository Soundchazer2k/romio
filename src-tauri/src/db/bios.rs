// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::bios::BiosRule;

/// Load BIOS rules for a specific system from the embedded JSON database.
/// The JSON file is bundled with the app binary and loaded at runtime.
pub fn load_rules_for_system(system: &str) -> Result<Vec<BiosRule>> {
    let all: Vec<BiosRule> = load_all_rules()?;
    Ok(all.into_iter().filter(|r| r.system == system).collect())
}

pub fn load_all_rules() -> Result<Vec<BiosRule>> {
    let json = include_str!("../../data/bios_rules.json");
    let rules: Vec<BiosRule> = serde_json::from_str(json)?;
    Ok(rules)
}
