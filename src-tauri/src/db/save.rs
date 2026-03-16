// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::save::SavePathRule;

pub fn load_rules() -> Result<Vec<SavePathRule>> {
    let json = include_str!("../../data/save_paths.json");
    let rules: Vec<SavePathRule> = serde_json::from_str(json)?;
    Ok(rules)
}
