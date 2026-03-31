// SPDX-License-Identifier: GPL-3.0
//! Project-wide BIOS sweep engine.
//! Pure Rust — no Tauri or DB dependencies. Rules are injected by the command layer.

use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::bios::{BiosRule, BiosSystemResult};
// BiosRequirement is only needed in tests — keep it out of module-level imports.

pub struct BiosSystemDef {
    pub id:               &'static str,
    pub default_emulator: &'static str,
}

pub const BIOS_SYSTEMS: &[BiosSystemDef] = &[
    BiosSystemDef { id: "ps1",       default_emulator: "duckstation"        },
    BiosSystemDef { id: "ps2",       default_emulator: "pcsx2"              },
    BiosSystemDef { id: "saturn",    default_emulator: "lr-beetle-saturn"   },
    BiosSystemDef { id: "segacd",    default_emulator: "lr-genesis-plus-gx" },
    BiosSystemDef { id: "sega32x",   default_emulator: "lr-picodrive"       },
    BiosSystemDef { id: "dreamcast", default_emulator: "lr-flycast"         },
    BiosSystemDef { id: "tg16cd",    default_emulator: "lr-beetle-pce"      },
    BiosSystemDef { id: "nds",       default_emulator: "melonds"            },
    BiosSystemDef { id: "fds",       default_emulator: "lr-mesen"           },
    BiosSystemDef { id: "3do",       default_emulator: "lr-opera"           },
    BiosSystemDef { id: "neogeo",    default_emulator: "lr-fbneo"           },
    BiosSystemDef { id: "xbox",      default_emulator: "xemu"               },
];

pub struct BiosSweepConfig {
    pub bios_root:      PathBuf,
    pub frontend:       String,
    pub emulator_prefs: HashMap<String, String>,
}

pub fn run_sweep(
    config:    &BiosSweepConfig,
    all_rules: &[BiosRule],
) -> Result<Vec<BiosSystemResult>> {
    let mut results = Vec::with_capacity(BIOS_SYSTEMS.len());

    for system in BIOS_SYSTEMS {
        let emulator = config.emulator_prefs
            .get(system.id)
            .map(String::as_str)
            .unwrap_or(system.default_emulator);

        let rules: Vec<&BiosRule> = all_rules.iter()
            .filter(|r| r.system == system.id)
            .collect();

        if rules.is_empty() {
            // System not in rules database — not applicable, not an error
            results.push(BiosSystemResult {
                system:   system.id.to_string(),
                entries:  vec![],
                blocking: false,
                errored:  false,
            });
            continue;
        }

        match crate::engine::bios_validator::validate_system_bios(
            &config.bios_root,
            &rules.into_iter().cloned().collect::<Vec<_>>(),
            &config.frontend,
            emulator,
        ) {
            Ok(result) => results.push(result),
            Err(e) => {
                eprintln!("[bios_sweep] validation failed for system={} err={}", system.id, e);
                results.push(BiosSystemResult {
                    system:   system.id.to_string(),
                    entries:  vec![],
                    blocking: false,
                    errored:  true,
                });
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use crate::models::bios::{BiosRule, BiosRequirement};
    // Note: BadDumpEntry not imported — not needed in these tests.

    fn make_rule(system: &str, filename: &str, md5: &str, req: BiosRequirement) -> BiosRule {
        BiosRule {
            filename:          filename.to_string(),
            known_good_md5:    vec![md5.to_string()],
            known_bad_md5:     vec![],
            system:            system.to_string(),
            region:            None,
            requirement:       req,
            compressed:        false,
            default_path:      "".to_string(),
            frontend_paths:    HashMap::new(),
            emulator_paths:    HashMap::new(),
            notes:             None,
            dumping_guide_url: None,
        }
    }

    #[test]
    fn test_sweep_all_systems_returned_on_empty_dir() {
        let dir = TempDir::new().unwrap();
        let config = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let results = run_sweep(&config, &[]).unwrap();
        assert_eq!(results.len(), BIOS_SYSTEMS.len(),
            "sweep must return one result per canonical system");
        // All should be non-blocking, non-errored (no rules = not applicable)
        assert!(results.iter().all(|r| !r.blocking && !r.errored));
    }

    #[test]
    fn test_sweep_blocking_when_required_bios_missing() {
        let dir = TempDir::new().unwrap();
        let config = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let rule = make_rule("ps1", "scph5501.bin", "deadbeef00000000deadbeef00000000",
                             BiosRequirement::Required);
        let results = run_sweep(&config, &[rule]).unwrap();
        let ps1 = results.iter().find(|r| r.system == "ps1").unwrap();
        assert!(ps1.blocking, "missing required BIOS must set blocking: true");
        assert!(!ps1.errored);
    }

    #[test]
    fn test_sweep_emulator_pref_overrides_default() {
        // This test is deliberately falsifiable: the file is placed at the lr-pcsx-rearmed
        // emulator-specific path. With the default emulator (duckstation), the validator
        // expects the file in a "duckstation/" subdir and will find it at the wrong path
        // (PresentWrongPath). With the override, it expects "lr-psx/" and finds it there
        // (PresentValid). This proves path resolution actually uses the emulator pref.

        let dir = TempDir::new().unwrap();

        // Place the file at the lr-pcsx-rearmed-specific path
        let lr_dir = dir.path().join("lr-psx");
        std::fs::create_dir_all(&lr_dir).unwrap();
        let data = b"fake bios content";
        let hash = crate::engine::hash::md5_bytes(data);
        std::fs::write(lr_dir.join("scph5501.bin"), data).unwrap();

        // Rule: default path is "duckstation" subdir; lr-pcsx-rearmed override is "lr-psx"
        let mut emulator_paths = HashMap::new();
        emulator_paths.insert("lr-pcsx-rearmed".to_string(), "lr-psx".to_string());
        let rule = BiosRule {
            filename:          "scph5501.bin".to_string(),
            known_good_md5:    vec![hash.clone()],
            known_bad_md5:     vec![],
            system:            "ps1".to_string(),
            region:            None,
            requirement:       BiosRequirement::Required,
            compressed:        false,
            default_path:      "duckstation".to_string(),
            frontend_paths:    HashMap::new(),
            emulator_paths,
            notes:             None,
            dumping_guide_url: None,
        };

        // Without override — default emulator "duckstation": expects file in "duckstation/" dir
        let config_default = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: HashMap::new(),
        };
        let results = run_sweep(&config_default, &[rule.clone()]).unwrap();
        let ps1 = results.iter().find(|r| r.system == "ps1").unwrap();
        assert_eq!(
            ps1.entries[0].state,
            crate::models::artifact::BiosValidationState::PresentWrongPath,
            "without override, file at lr-psx path must be flagged as wrong path for duckstation"
        );

        // With lr-pcsx-rearmed override: expects file in "lr-psx/" dir → PresentValid
        let mut prefs = HashMap::new();
        prefs.insert("ps1".to_string(), "lr-pcsx-rearmed".to_string());
        let config_override = BiosSweepConfig {
            bios_root:      dir.path().to_path_buf(),
            frontend:       "esde".to_string(),
            emulator_prefs: prefs,
        };
        let results2 = run_sweep(&config_override, &[rule]).unwrap();
        let ps1_v2 = results2.iter().find(|r| r.system == "ps1").unwrap();
        assert_eq!(
            ps1_v2.entries[0].state,
            crate::models::artifact::BiosValidationState::PresentValid,
            "with lr-pcsx-rearmed override, file must be found at correct path"
        );
    }
}
