// SPDX-License-Identifier: GPL-3.0
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorMatrixEntry {
    pub system:       String,
    pub recommended:  String,
    pub alternatives: Vec<String>,
    pub status:       String,
    pub bios_required: bool,
    pub notes:        Option<String>,
}
