// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::emulator::EmulatorMatrixEntry;

const EMULATOR_DATA: &str = include_str!("../../data/emulator_matrix.json");

pub fn load_emulator_matrix() -> Result<Vec<EmulatorMatrixEntry>> {
    Ok(serde_json::from_str(EMULATOR_DATA)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_without_error() {
        let entries = load_emulator_matrix().expect("emulator matrix should parse");
        assert!(!entries.is_empty());
    }
}
