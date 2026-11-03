// SPDX-License-Identifier: GPL-3.0
//! End-to-end engine checks against fake libraries shaped like real setups.
//! One test per user scenario from DESIGN.md; rules are the shipped data files.

mod common;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use common::{deny_read, fixture_bios_rules, with_bad_dump, Library};
use romio_lib::db;
use romio_lib::engine::bios_sweep::{run_sweep, BiosSweepConfig};
use romio_lib::engine::format_matrix::check_format;
use romio_lib::engine::save_registry::{discover_save_roots, SaveAnchors};
use romio_lib::engine::scanner::scan_roots;
use romio_lib::models::artifact::{ArtifactType, BiosValidationState as Bios, FormatCompatibilityState as Fmt};
use romio_lib::models::bios::{BiosEntryResult, BiosSystemResult};
use romio_lib::models::format::{FormatFixType, FormatSupport};
use romio_lib::models::save::{SaveMigrationState as Save, SaveRoot};

fn bios_entry<'a>(results: &'a [BiosSystemResult], filename: &str) -> &'a BiosEntryResult {
    results.iter()
        .flat_map(|s| &s.entries)
        .find(|e| e.rule.filename == filename)
        .unwrap_or_else(|| panic!("no result for {filename}"))
}

fn save_root<'a>(roots: &'a [SaveRoot], emulator: &str) -> &'a SaveRoot {
    roots.iter()
        .find(|r| r.emulator == emulator)
        .unwrap_or_else(|| panic!("no save root for {emulator}: {roots:#?}"))
}

fn sweep(bios_root: &std::path::Path, frontend: &str, rules: &[romio_lib::models::bios::BiosRule]) -> Vec<BiosSystemResult> {
    let config = BiosSweepConfig {
        bios_root:      bios_root.to_path_buf(),
        frontend:       frontend.into(),
        emulator_prefs: Default::default(),
    };
    run_sweep(&config, rules).expect("sweep runs")
}

/// Curator before a change: a big RetroBat install about to update emulators.
/// Romio must find every save root at risk and flag formats that won't load.
#[test]
fn curator_retrobat_library_before_an_update() {
    let lib = Library::new();
    let appdata = Library::new();

    // Games across systems, plus files that aren't games
    let games = [
        "roms/psx/Ape Escape (USA).chd",
        "roms/psx/Final Fantasy VII (USA).m3u",
        "roms/gamecube/Wind Waker (USA).rvz",
        "roms/daphne/lair.daphne",
        "roms/n64/Mario Kart 64 (USA).z64",
        "roms/xbox/Halo (USA).iso",
        "roms/xbox360/Halo 3 (USA).iso",
    ];
    for g in games { lib.game(g); }
    lib.file("roms/psx/gamelist.xml", b"<gameList/>");

    // Saves: PPSSPP still at its old path, RPCS3 at both, Xenia already moved,
    // and yuzu saves in %APPDATA% waiting for Eden
    lib.saves("emulators/ppsspp/memstick/PSP/SAVEDATA", 3);
    lib.saves("emulators/rpcs3/dev_hdd0/home/00000001/savedata", 2);
    lib.saves("saves/ps3/rpcs3/hdd_0/home/00000001/savedata", 1);
    lib.saves("saves/xbox360/xenia/profile", 1);
    appdata.saves("yuzu/nand/user/save/0000000000000000", 4);

    // Scan: every file is classified, each as the right type
    let artifacts = scan_roots(&[lib.path("roms")], Arc::new(AtomicBool::new(false)), |_| {}).unwrap();
    assert_eq!(artifacts.len(), games.len() + 1);
    let type_of = |rel: &str| {
        let path = lib.path(rel).to_string_lossy().to_string();
        artifacts.iter()
            .find(|a| a.source_path == path)
            .unwrap_or_else(|| panic!("{rel} not scanned"))
            .artifact_type.clone()
    };
    assert_eq!(type_of("roms/psx/Ape Escape (USA).chd"), ArtifactType::Rom);
    assert_eq!(type_of("roms/psx/Final Fantasy VII (USA).m3u"), ArtifactType::M3u);
    assert_eq!(type_of("roms/gamecube/Wind Waker (USA).rvz"), ArtifactType::Rom);
    assert_eq!(type_of("roms/daphne/lair.daphne"), ArtifactType::Rom, "deprecated, but still a game");
    assert_eq!(type_of("roms/n64/Mario Kart 64 (USA).z64"), ArtifactType::Rom);
    assert_eq!(type_of("roms/psx/gamelist.xml"), ArtifactType::Unknown, "gamelist.xml is not a game");

    // Formats against the shipped matrix
    let rules = db::format::load_rules().unwrap();
    let check = |rel: &str, system: &str, emulator: &str| check_format(&lib.path(rel), &rules, system, emulator, "retrobat");

    assert_eq!(check("roms/psx/Ape Escape (USA).chd", "ps1", "duckstation").state, Fmt::Compatible);
    assert_eq!(check("roms/gamecube/Wind Waker (USA).rvz", "gamecube", "lr-dolphin").state, Fmt::FormatIncompatible);
    let daphne = check("roms/daphne/lair.daphne", "daphne", "hypseus");
    assert_eq!(daphne.state, Fmt::FormatDeprecated);
    assert!(matches!(daphne.fix_action.map(|f| f.action_type), Some(FormatFixType::Rename)));
    assert_eq!(check("roms/n64/Mario Kart 64 (USA).z64", "n64", "mupen64plus").state, Fmt::Unknown,
        "no rule means unknown, never a guess");

    // XISO is xemu's requirement (original Xbox), not Xenia's: Xenia reads full 360 disc images too
    let xbox = check("roms/xbox/Halo (USA).iso", "xbox", "xemu");
    assert_eq!(xbox.state, Fmt::Compatible);
    assert!(xbox.notes.as_deref().unwrap_or("").starts_with("Must be an XISO"), "xemu warns about XISO");
    let x360 = check("roms/xbox360/Halo 3 (USA).iso", "xbox360", "xenia-canary");
    assert_eq!(x360.state, Fmt::Compatible);
    // A Conditional rule is how a format requirement is expressed, whatever its wording
    for emu in ["xenia", "xenia-canary"] {
        let rule = rules.iter()
            .find(|r| r.system == "xbox360" && r.extension == "iso" && r.emulator == emu)
            .unwrap_or_else(|| panic!("{emu} .iso rule missing"));
        assert!(matches!(rule.support, FormatSupport::Supported), "{emu} must not carry an XISO condition");
    }

    // Saves against the shipped registry
    let save_rules = db::save::load_rules().unwrap();
    let roots = discover_save_roots(lib.root(), &SaveAnchors { appdata: Some(appdata.root()), ..Default::default() }, &save_rules);

    let ppsspp = save_root(&roots, "ppsspp");
    assert_eq!(ppsspp.migration_state, Save::MigrationNeeded);
    assert_eq!(ppsspp.file_count, 3);
    assert_eq!(ppsspp.expected_destination.as_deref(), Some(lib.path("saves/psp").to_string_lossy().as_ref()));

    assert_eq!(save_root(&roots, "rpcs3").migration_state, Save::ConflictDetected);

    let eden = save_root(&roots, "eden");
    assert_eq!(eden.migration_state, Save::MigrationNeeded);
    assert_eq!(eden.file_count, 4);
    assert!(eden.path.starts_with(&*appdata.root().to_string_lossy()), "eden saves resolve under APPDATA");

    // Xenia and Xenia Canary share a destination: one row, not two
    let xenia_rows = roots.iter().filter(|r| r.emulator.starts_with("xenia")).count();
    assert_eq!(xenia_rows, 1);

    // Emulators with no saves on disk stay out of the list
    assert!(roots.iter().all(|r| r.emulator != "cemu" && r.emulator != "vita3k"));
}

/// First-time handheld setup: a fresh Batocera box with an almost empty BIOS folder.
/// Romio must say which BIOS blocks play and which one is merely in the wrong place.
#[test]
fn handheld_batocera_fresh_setup_bios() {
    let lib = Library::new();
    let bios_root = lib.path("userdata/bios");
    std::fs::create_dir_all(&bios_root).unwrap();
    let rules = fixture_bios_rules();

    // Empty folder: PS1 is blocked, nothing is reported present
    let results = sweep(&bios_root, "batocera", &rules);
    let ps1 = results.iter().find(|s| s.system == "ps1").unwrap();
    assert!(ps1.blocking, "missing required PS1 BIOS blocks play");
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::MissingRequired);
    assert_eq!(bios_entry(&results, "scph1001.bin").state, Bios::MissingOptional);

    // Drop in the US PS1 BIOS and a Dreamcast BIOS at the root, where lr-flycast won't look
    lib.bios("userdata/bios/scph5501.bin", "scph5501.bin");
    lib.bios("userdata/bios/dc_boot.bin", "dc_boot.bin");

    let results = sweep(&bios_root, "batocera", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);

    let dc = bios_entry(&results, "dc_boot.bin");
    assert_eq!(dc.state, Bios::PresentWrongPath, "lr-flycast expects bios/dc/");
    assert_eq!(dc.rename_from, None, "right name, wrong folder");

    // Move it where lr-flycast looks
    std::fs::create_dir_all(lib.path("userdata/bios/dc")).unwrap();
    std::fs::rename(lib.path("userdata/bios/dc_boot.bin"), lib.path("userdata/bios/dc/dc_boot.bin")).unwrap();
    let results = sweep(&bios_root, "batocera", &rules);
    assert_eq!(bios_entry(&results, "dc_boot.bin").state, Bios::PresentValid);
}

/// ES-DE keeps neogeo.zip with the arcade ROMs, outside the BIOS folder.
/// Romio must find it there, call it valid, and not block Neo Geo.
#[test]
fn esde_neogeo_bios_in_roms_arcade_is_found() {
    let lib = Library::new();
    let bios_root = lib.path("Emulation/bios");
    std::fs::create_dir_all(&bios_root).unwrap();
    let rules = fixture_bios_rules();

    let results = sweep(&bios_root, "esde", &rules);
    assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::MissingRequired);

    // ES-DE's path is bios/../../roms/arcade/, i.e. roms/arcade beside Emulation/
    lib.bios("roms/arcade/neogeo.zip", "neogeo.zip");
    let results = sweep(&bios_root, "esde", &rules);
    let neogeo = bios_entry(&results, "neogeo.zip");
    assert_eq!(neogeo.state, Bios::PresentValid, "{neogeo:#?}");
    assert!(!results.iter().find(|s| s.system == "neogeo").unwrap().blocking);

    // The same file inside bios/ is in the wrong place for ES-DE
    std::fs::rename(lib.path("roms/arcade/neogeo.zip"), lib.path("Emulation/bios/neogeo.zip")).unwrap();
    let results = sweep(&bios_root, "esde", &rules);
    assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::PresentWrongPath);
}

/// EmuDeck and RetroDECK run ES-DE, so ES-DE's placement rules must apply to them too.
#[test]
fn emudeck_and_retrodeck_follow_esde_bios_rules() {
    let lib = Library::new();
    let bios_root = lib.path("Emulation/bios");
    std::fs::create_dir_all(&bios_root).unwrap();
    lib.bios("roms/arcade/neogeo.zip", "neogeo.zip");
    let rules = fixture_bios_rules();

    for frontend in ["emudeck", "retrodeck"] {
        let results = sweep(&bios_root, frontend, &rules);
        assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::PresentValid, "{frontend}");
    }
}

/// A rule shipped with no known-good hash can't be validated, fixture or not.
#[test]
fn bios_rule_without_shipped_hash_is_never_reported_valid() {
    let lib = Library::new();
    let mut rules = fixture_bios_rules();
    let unhashed = rules.iter_mut().find(|r| r.filename == "scph39001.bin").unwrap();
    unhashed.known_good_md5.clear();
    lib.bios("bios/scph39001.bin", "scph39001.bin");

    let results = sweep(&lib.path("bios"), "esde", &rules);
    assert_ne!(bios_entry(&results, "scph39001.bin").state, Bios::PresentValid);
}

/// Rescuer after breakage: games stopped working after an update.
/// Romio must name the bad dump, the renamed file, and the saves now split in two places.
#[test]
fn rescuer_finds_bad_dump_renamed_bios_and_split_saves() {
    let lib = Library::new();
    let appdata = Library::new();
    let rules = with_bad_dump(fixture_bios_rules(), "scph5502.bin", "scph5502-overdump", "Overdump (1 MB)");

    // A bad EU dump under the right name, and a good US dump under the wrong name
    lib.bios("bios/scph5502.bin", "scph5502-overdump");
    lib.bios("bios/SCPH5501 (backup).bin", "scph5501.bin");

    let results = sweep(&lib.path("bios"), "esde", &rules);

    let eu = bios_entry(&results, "scph5502.bin");
    assert_eq!(eu.state, Bios::PresentHashMismatch);
    assert_eq!(eu.bad_dump_label.as_deref(), Some("Overdump (1 MB)"));

    let us = bios_entry(&results, "scph5501.bin");
    assert_eq!(us.state, Bios::PresentWrongPath, "found by hash, not by name");
    assert_eq!(us.rename_from.as_deref(), Some("SCPH5501 (backup).bin"));

    // Citra was replaced by Azahar, which started fresh: saves now live in both places
    appdata.saves("Citra/sdmc/Nintendo 3DS/save", 5);
    appdata.saves("Azahar/sdmc/Nintendo 3DS/save", 1);

    let roots = discover_save_roots(std::path::Path::new(""), &SaveAnchors { appdata: Some(appdata.root()), ..Default::default() }, &db::save::load_rules().unwrap());
    assert_eq!(roots.len(), 1, "one Azahar row, not one per source rule: {roots:#?}");
    let azahar = &roots[0];
    assert_eq!(azahar.migration_state, Save::ConflictDetected);
    assert_eq!(azahar.file_count, 5, "counts the saves still to move, not the fresh ones");
    assert!(azahar.notes.is_some(), "the rule's note explains the move");
}

/// Handheld on a Steam Deck: Linux keeps emulator data under ~/.local/share.
/// The same moves as on Windows must be found there, under Linux folder names.
#[test]
fn steam_deck_saves_under_xdg_data_home() {
    let xdg = Library::new();
    xdg.saves("yuzu/nand/user/save/0000000000000000", 2);
    xdg.saves("citra-emu/sdmc/Nintendo 3DS/save", 3);

    let anchors = SaveAnchors { xdg_data: Some(xdg.root()), ..Default::default() };
    let roots = discover_save_roots(std::path::Path::new(""), &anchors, &db::save::load_rules().unwrap());

    let eden = save_root(&roots, "eden");
    assert_eq!(eden.migration_state, Save::MigrationNeeded);
    assert_eq!(eden.expected_destination.as_deref(), Some(xdg.path("eden/nand/user/save").to_string_lossy().as_ref()));

    let azahar = save_root(&roots, "azahar");
    assert_eq!(azahar.migration_state, Save::MigrationNeeded);
    assert_eq!(azahar.file_count, 3);
    assert_eq!(azahar.expected_destination.as_deref(), Some(xdg.path("azahar-emu/sdmc").to_string_lossy().as_ref()));

    // Windows folder names under ~/.local/share mean nothing
    let windows_style = Library::new();
    windows_style.saves("Citra/sdmc", 1);
    let anchors = SaveAnchors { xdg_data: Some(windows_style.root()), ..Default::default() };
    assert!(discover_save_roots(std::path::Path::new(""), &anchors, &db::save::load_rules().unwrap()).is_empty());
}

/// Handheld setup checking formats before copying games over: each system's default
/// emulator must give a verdict on its common formats, not "Unknown".
#[test]
fn default_emulators_judge_their_common_formats() {
    let lib = Library::new();
    let rules = db::format::load_rules().unwrap();
    let check = |rel: &str, system: &str, emulator: &str| {
        lib.game(rel);
        check_format(&lib.path(rel), &rules, system, emulator, "esde")
    };

    for (rel, system, emulator) in [
        ("roms/psp/Patapon.chd", "psp", "ppsspp"),
        ("roms/psp/Patapon.cso", "psp", "ppsspp"),
        ("roms/n3ds/Pokemon Y.zcci", "3ds", "azahar"),
        ("roms/n3ds/Pokemon Y.3ds", "3ds", "azahar"),
        ("roms/ps3/Demon's Souls.iso", "ps3", "rpcs3"),
        ("roms/ps2/Okami.cso", "ps2", "pcsx2"),
        ("roms/gc/Wind Waker.iso", "gamecube", "dolphin"),
        ("roms/wii/Mario Galaxy.wbfs", "wii", "dolphin"),
    ] {
        assert_eq!(check(rel, system, emulator).state, Fmt::Compatible, "{rel}");
    }

    // PPSSPP can't read .zso; Romio says so and offers no rename
    let zso = check("roms/psp/Patapon.zso", "psp", "ppsspp");
    assert_eq!(zso.state, Fmt::FormatIncompatible);
    assert!(zso.notes.unwrap_or_default().contains(".cso"), "points to a format that works");

    // .cia installs into Azahar rather than booting: allowed, with that warning
    let cia = check("roms/n3ds/Pokemon Y.cia", "3ds", "azahar");
    assert_eq!(cia.state, Fmt::Compatible);
    assert!(cia.notes.unwrap_or_default().starts_with("Azahar installs"));
}

/// Rescuer whose saves are locked: a save root Romio can't read, wholly or in part,
/// must say so instead of looking missing or reporting short totals.
#[test]
fn locked_save_roots_are_reported_unreadable_not_missing() {
    let appdata = Library::new();
    let rules = db::save::load_rules().unwrap();
    let discover = || discover_save_roots(std::path::Path::new(""), &SaveAnchors { appdata: Some(appdata.root()), ..Default::default() }, &rules);

    // Whole root locked: yuzu's save folder can't be listed at all
    let yuzu = appdata.saves("yuzu/nand/user/save/0000000000000000", 4);
    let Some(locked) = deny_read(&appdata.path("yuzu/nand/user/save")) else {
        eprintln!("this OS ignores read denial (running as root?); skipping");
        return;
    };
    let roots = discover();
    let eden = save_root(&roots, "eden");
    assert_eq!(eden.migration_state, Save::Unreadable, "{roots:#?}");
    assert_eq!((eden.file_count, eden.size_bytes), (0, 0), "no guessed totals");
    assert_eq!(eden.expected_destination.as_deref(),
        Some(appdata.path("eden/nand/user/save").to_string_lossy().as_ref()));
    drop(locked);
    assert_eq!(save_root(&discover(), "eden").migration_state, Save::MigrationNeeded);

    // Only one subfolder locked: the root opens, but its totals would be short
    let _locked = deny_read(&yuzu).expect("read denial works here");
    assert_eq!(save_root(&discover(), "eden").migration_state, Save::Unreadable);
}

/// Opt-in check against your own library. Never runs in CI.
///
/// Set ROMIO_REAL_LIBRARY to a folder containing `roms/` and `bios/` (your own dumps),
/// optionally ROMIO_REAL_FRONTEND (default "esde"), then run:
/// `cargo test --test scenarios real_library -- --nocapture`
#[test]
fn real_library_smoke() {
    let Some(root) = std::env::var_os("ROMIO_REAL_LIBRARY") else {
        eprintln!("ROMIO_REAL_LIBRARY not set; skipping");
        return;
    };
    let root = std::path::PathBuf::from(root);
    let frontend = std::env::var("ROMIO_REAL_FRONTEND").unwrap_or_else(|_| "esde".into());
    // A typo in the path must fail, not pass with nothing checked
    for dir in ["roms", "bios"] {
        assert!(root.join(dir).is_dir(), "{} is not a folder", root.join(dir).display());
    }

    let artifacts = scan_roots(&[root.join("roms")], Arc::new(AtomicBool::new(false)), |_| {})
        .expect("scan completes");
    assert!(!artifacts.is_empty(), "no files found under {}", root.join("roms").display());
    let results = sweep(&root.join("bios"), &frontend, &db::bios::load_all_rules().unwrap());

    eprintln!("scanned {} files", artifacts.len());
    for system in &results {
        for e in &system.entries {
            eprintln!("{:<10} {:<24} {:?}", system.system, e.rule.filename, e.state);
        }
    }
    assert!(results.iter().all(|s| !s.errored), "no system errored");
}
