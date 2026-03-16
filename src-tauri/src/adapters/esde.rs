// SPDX-License-Identifier: GPL-3.0
//! ES-DE frontend adapter.
//!
//! All known ES-DE-specific path quirks are encoded here as first-class rules.
//! These quirks cause silent failures — no error output — when violated.

use super::FrontendAdapter;

pub struct EsDeAdapter;

impl FrontendAdapter for EsDeAdapter {
    fn frontend_id(&self)   -> &'static str { "esde" }
    fn frontend_name(&self) -> &'static str { "ES-DE" }

    fn validate_bios_path(&self, system: &str, emulator: &str) -> String {
        // ES-DE BIOS path quirks — these differ from every other frontend.
        match (system, emulator) {
            // CRITICAL: FBNeo and MAME arcade BIOS must be in roms/arcade/
            // NOT in bios/ or bios/mame/ — those paths are searched by other frontends
            // but silently ignored by ES-DE.
            ("neogeo", _)
            | ("arcade", "lr-fbneo")
            | ("arcade", "mame")
            | ("fbneo", _)       => "roms/arcade/".to_string(),

            // Philips CD-i with MAME standalone — BIOS in roms/cdimono/
            ("cdimono1", "mame") => "roms/cdimono/".to_string(),

            // Tiger Game.com — BIOS in roms/gamecom/
            ("gamecom", _)       => "roms/gamecom/".to_string(),

            // VTech V.Smile — BIOS in roms/vsmile/
            ("vsmile", _)        => "roms/vsmile/".to_string(),

            // Saturn with Kronos core — requires bios/kronos/ subdirectory
            ("saturn", "lr-kronos") => "bios/kronos/".to_string(),

            // Dreamcast lr-flycast — bios/dc/ subfolder required
            ("dreamcast", "lr-flycast") => "bios/dc/".to_string(),

            // All other systems use the flat bios/ directory
            _ => "bios/".to_string(),
        }
    }

    fn validate_rom_path(&self, system: &str) -> String {
        format!("roms/{}/", system)
    }
}

/// ES-DE-specific format validation rules.
/// These are additional checks on top of the general format matrix.
pub fn check_esde_format_quirks(path: &str) -> Option<EsDeFormatQuirk> {
    let lower = path.to_lowercase();

    // The .daphne extension was renamed to .hypseus when Hypseus Singe replaced Daphne.
    // .daphne files are silently rejected — no error message.
    if lower.ends_with(".daphne") {
        return Some(EsDeFormatQuirk::DeprecatedDaphneExtension {
            current: path.to_string(),
            replacement: path[..path.len()-7].to_string() + ".hypseus",
        });
    }

    None
}

#[derive(Debug)]
pub enum EsDeFormatQuirk {
    /// .daphne → .hypseus — safe rename, content unchanged
    DeprecatedDaphneExtension {
        current:     String,
        replacement: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_neogeo_bios_path_esde() {
        let adapter = EsDeAdapter;
        let path = adapter.validate_bios_path("neogeo", "lr-fbneo");
        assert_eq!(path, "roms/arcade/");
    }

    #[test]
    fn test_saturn_kronos_path() {
        let adapter = EsDeAdapter;
        let path = adapter.validate_bios_path("saturn", "lr-kronos");
        assert_eq!(path, "bios/kronos/");
    }

    #[test]
    fn test_dreamcast_flycast_core_path() {
        let adapter = EsDeAdapter;
        let path = adapter.validate_bios_path("dreamcast", "lr-flycast");
        assert_eq!(path, "bios/dc/");
    }

    #[test]
    fn test_ps1_default_bios_path() {
        let adapter = EsDeAdapter;
        let path = adapter.validate_bios_path("ps1", "duckstation");
        assert_eq!(path, "bios/");
    }

    #[test]
    fn test_daphne_extension_flagged() {
        let result = check_esde_format_quirks("/roms/daphne/dragon_lair.daphne");
        assert!(result.is_some());
        if let Some(EsDeFormatQuirk::DeprecatedDaphneExtension { replacement, .. }) = result {
            assert!(replacement.ends_with(".hypseus"));
        }
    }

    #[test]
    fn test_hypseus_extension_clean() {
        let result = check_esde_format_quirks("/roms/daphne/dragon_lair.hypseus");
        assert!(result.is_none());
    }
}
