// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::format::FormatRule;

pub fn load_rules() -> Result<Vec<FormatRule>> {
    let json = include_str!("../../data/format_matrix.json");
    let rules: Vec<FormatRule> = serde_json::from_str(json)?;
    Ok(rules)
}
