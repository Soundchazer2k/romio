// SPDX-License-Identifier: GPL-3.0
//! End-to-end engine checks against fake libraries shaped like real setups.
//! One test per user scenario from DESIGN.md; rules are the shipped data files.

mod common;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use common::{deny_read, fake_md5, fixture_bios_rules, with_bad_dump, Library};
use romio_lib::db;
use romio_lib::engine::bios_sweep::{run_sweep, BiosSweepConfig};
use romio_lib::engine::format_matrix::{check_format, list_system_folders};
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

/// The same sweep, with one system set to a chosen emulator.
fn sweep_as(bios_root: &std::path::Path, system: &str, emulator: &str, rules: &[romio_lib::models::bios::BiosRule]) -> Vec<BiosSystemResult> {
    let config = BiosSweepConfig {
        bios_root: bios_root.to_path_buf(),
        frontend: "retrobat".into(),
        emulator_prefs: [(system.to_string(), emulator.to_string())].into_iter().collect(),
    };
    run_sweep(&config, rules).expect("sweep runs")
}

fn is_blocking(results: &[BiosSystemResult], system: &str) -> bool {
    results.iter().find(|s| s.system == system).unwrap().blocking
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
    assert!(xbox.condition.as_deref().unwrap_or("").starts_with("Must be an XISO"), "xemu warns about XISO");
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

/// FBNeo looks for neogeo.zip beside the romset, then in the system folder, and ES-DE's
/// guide puts BIOS files with the ROMs. All of those must count as correctly placed.
#[test]
fn neogeo_bios_is_valid_wherever_fbneo_looks() {
    let lib = Library::new();
    let bios_root = lib.path("Emulation/bios");
    std::fs::create_dir_all(&bios_root).unwrap();
    let rules = fixture_bios_rules();

    let results = sweep(&bios_root, "esde", &rules);
    assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::MissingRequired);

    for place in ["roms/arcade/neogeo.zip", "roms/neogeo/neogeo.zip", "Emulation/roms/neogeo/neogeo.zip",
                  "Emulation/bios/neogeo.zip", "Emulation/bios/fbneo/neogeo.zip"] {
        let file = lib.bios(place, "neogeo.zip");
        let results = sweep(&bios_root, "esde", &rules);
        let neogeo = bios_entry(&results, "neogeo.zip");
        assert_eq!(neogeo.state, Bios::PresentValid, "{place}: {neogeo:#?}");
        assert!(!results.iter().find(|s| s.system == "neogeo").unwrap().blocking, "{place}");
        std::fs::remove_file(file).unwrap();
    }

    // Anywhere else in the BIOS folder, the core won't find it
    lib.bios("Emulation/bios/misc/neogeo.zip", "neogeo.zip");
    let results = sweep(&bios_root, "esde", &rules);
    assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::PresentWrongPath);
    assert!(results.iter().find(|s| s.system == "neogeo").unwrap().blocking);
}

/// A corrupt or misplaced required BIOS won't boot anything, so it must block,
/// not fall through to a green "All valid".
#[test]
fn bad_or_misplaced_required_bios_blocks() {
    let lib = Library::new();
    let bios_root = lib.path("bios");
    let rules = fixture_bios_rules();
    let blocking = |results: &[BiosSystemResult], id: &str| results.iter().find(|s| s.system == id).unwrap().blocking;

    lib.file("bios/mcpx_1.0.bin", b"corrupt dump");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "mcpx_1.0.bin").state, Bios::PresentHashMismatch);
    assert!(blocking(&results, "xbox"), "bad required BIOS blocks");

    lib.bios("bios/misc/disksys.rom", "disksys.rom");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "disksys.rom").state, Bios::PresentWrongPath);
    assert!(blocking(&results, "fds"), "misplaced required BIOS blocks");

    // A zip's hash changes when it's rebuilt, so a different neogeo.zip is a warning only
    lib.file("bios/neogeo.zip", b"another romset version");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "neogeo.zip").state, Bios::PresentHashMismatch);
    assert!(!blocking(&results, "neogeo"));

    // Another region's bad file doesn't stop a complete region from playing
    lib.bios("bios/scph5501.bin", "scph5501.bin");
    lib.file("bios/scph5500.bin", b"corrupt dump");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "scph5500.bin").state, Bios::PresentHashMismatch);
    assert!(!blocking(&results, "ps1"));
}

/// Older lr-opera builds won't boot without a BIOS file and Romio can't see the core's
/// build, so a missing panafz10.bin blocks, even though newer builds have a built-in BIOS.
#[test]
fn three_do_requires_a_bios_file() {
    let lib = Library::new();
    let bios_root = lib.path("bios");
    std::fs::create_dir_all(&bios_root).unwrap();
    let rules = fixture_bios_rules();

    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "panafz10.bin").state, Bios::MissingRequired);
    assert!(is_blocking(&results, "3do"));

    let file = lib.file("bios/panafz10.bin", b"corrupt dump");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "panafz10.bin").state, Bios::PresentHashMismatch);
    assert!(is_blocking(&results, "3do"));

    std::fs::remove_file(file).unwrap();
    lib.bios("bios/panafz10.bin", "panafz10.bin");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "panafz10.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "3do"));
}

/// A valid BIOS in place stays valid, whatever other copies sit elsewhere in the folder.
#[test]
fn backup_copies_do_not_hide_a_correctly_placed_bios() {
    let lib = Library::new();
    let bios_root = lib.path("bios");

    lib.bios("bios/scph5501.bin", "scph5501.bin");
    lib.bios("bios/a_backup/scph5501.bin", "scph5501.bin");
    lib.bios("bios/z_backup/scph5501.bin", "scph5501.bin");
    let results = sweep(&bios_root, "retrobat", &fixture_bios_rules());
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);

    // Even an old bad dump kept as a backup doesn't overrule the good file in place
    lib.bios("bios/old/old-dump.bin", "old-dump.bin");
    let rules = with_bad_dump(fixture_bios_rules(), "scph5501.bin", "old-dump.bin", "Known bad revision");
    let results = sweep(&bios_root, "retrobat", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);
}

/// Beetle Saturn needs mpr-17933.bin, Kronos needs saturn_bios.bin. Each emulator's
/// US file must complete the US region alone, and the other shows as not applicable.
#[test]
fn saturn_us_bios_depends_on_the_emulator() {
    let rules = fixture_bios_rules();
    let saturn = |lib: &Library, emulator: &str| {
        let config = BiosSweepConfig {
            bios_root: lib.path("bios"),
            frontend: "retrobat".into(),
            emulator_prefs: [("saturn".to_string(), emulator.to_string())].into_iter().collect(),
        };
        run_sweep(&config, &rules).unwrap().into_iter().find(|s| s.system == "saturn").unwrap()
    };
    let state = |result: &BiosSystemResult, file: &str| {
        result.entries.iter().find(|e| e.rule.filename == file).unwrap().state.clone()
    };

    let beetle = Library::new();
    beetle.bios("bios/mpr-17933.bin", "mpr-17933.bin");
    for emulator in ["lr-beetle-saturn", "ymir"] {
        let result = saturn(&beetle, emulator);
        assert!(!result.blocking, "{emulator}: {result:#?}");
        assert_eq!(state(&result, "saturn_bios.bin"), Bios::NotApplicable);
        assert_eq!(state(&result, "sega_101.bin"), Bios::MissingOptional);
    }

    let kronos = Library::new();
    kronos.bios("bios/kronos/saturn_bios.bin", "saturn_bios.bin");
    let result = saturn(&kronos, "lr-kronos");
    assert!(!result.blocking, "{result:#?}");
    assert_eq!(state(&result, "mpr-17933.bin"), Bios::NotApplicable);
}

/// Kronos reads one file for every region: kronos/saturn_bios.bin, then saturn_bios.bin,
/// sega_101.bin and mpr-17933.bin in the BIOS folder (retro_load_game in its libretro.c).
#[test]
fn kronos_reads_its_fallback_files() {
    let mut rules = fixture_bios_rules();
    // Fixture hashes stand in for the Saturn revisions the shipped rule lists
    let accepted = ["saturn_bios.bin", "sega_101.bin", "mpr-17933.bin"].map(fake_md5);
    rules.iter_mut().find(|r| r.filename == "saturn_bios.bin").unwrap().known_good_md5 = accepted.to_vec();

    for (place, bytes_of) in [
        ("bios/kronos/saturn_bios.bin", "saturn_bios.bin"),
        ("bios/saturn_bios.bin", "saturn_bios.bin"),
        ("bios/sega_101.bin", "sega_101.bin"),
        ("bios/mpr-17933.bin", "mpr-17933.bin"),
        ("bios/kronos/saturn_bios.bin", "mpr-17933.bin"), // another revision under the preferred name
    ] {
        let lib = Library::new();
        lib.bios(place, bytes_of);
        let results = sweep_as(&lib.path("bios"), "saturn", "lr-kronos", &rules);
        assert!(!is_blocking(&results, "saturn"), "{place} holding {bytes_of}: {results:#?}");
        assert_eq!(bios_entry(&results, "saturn_bios.bin").state, Bios::PresentValid, "{place}");
        assert_eq!(bios_entry(&results, "sega_101.bin").state, Bios::NotApplicable, "one file for every region");
    }

    // Kronos takes the first file that exists without checking it, so a good fallback
    // can't rescue a corrupt file ahead of it in that order
    let lib = Library::new();
    lib.file("bios/kronos/saturn_bios.bin", b"corrupt dump");
    lib.bios("bios/mpr-17933.bin", "mpr-17933.bin");
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-kronos", &rules);
    let kronos = bios_entry(&results, "saturn_bios.bin");
    assert_eq!(kronos.state, Bios::PresentHashMismatch, "{kronos:#?}");
    assert!(kronos.found_path.as_deref().unwrap_or("").ends_with("saturn_bios.bin"), "names the file it read");
    assert!(is_blocking(&results, "saturn"));

    // A bad file after the one it reads doesn't matter
    let lib = Library::new();
    lib.bios("bios/kronos/saturn_bios.bin", "saturn_bios.bin");
    lib.file("bios/mpr-17933.bin", b"corrupt dump");
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-kronos", &rules);
    assert_eq!(bios_entry(&results, "saturn_bios.bin").state, Bios::PresentValid);

    // Kronos doesn't look anywhere else
    let lib = Library::new();
    lib.bios("bios/misc/mpr-17933.bin", "mpr-17933.bin");
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-kronos", &rules);
    assert!(is_blocking(&results, "saturn"), "not where Kronos looks");
}

/// PCSX2, DuckStation, Ymir and Beetle PSX find a BIOS by its contents at the top of
/// their folder, so the filename doesn't matter there. Subfolders aren't searched, and
/// cores that open an exact name still need it.
#[test]
fn emulators_that_read_contents_accept_any_filename() {
    let rules = fixture_bios_rules();

    let lib = Library::new();
    lib.bios("bios/my-ps2.bin", "SCPH-70012_BIOS_V12_USA_200.bin");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    let ps2 = bios_entry(&results, "SCPH-70012_BIOS_V12_USA_200.bin");
    assert_eq!(ps2.state, Bios::PresentValid);
    assert_eq!(ps2.rename_from, None, "nothing to rename");
    assert!(!is_blocking(&results, "ps2"));

    let lib = Library::new();
    lib.bios("bios/misc/my-ps2.bin", "SCPH-70012_BIOS_V12_USA_200.bin");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    assert_eq!(bios_entry(&results, "SCPH-70012_BIOS_V12_USA_200.bin").state, Bios::PresentWrongPath);
    assert!(is_blocking(&results, "ps2"), "PCSX2 doesn't search subfolders");

    let lib = Library::new();
    lib.bios("bios/PS1 US.bin", "scph5501.bin");
    let results = sweep_as(&lib.path("bios"), "ps1", "duckstation", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "ps1"));
    // Beetle PSX searches by checksum when its named files are absent
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "ps1"));

    // ...but a named file stops that search, even when it's corrupt. DuckStation
    // goes by contents, so the same corrupt file doesn't get in its way.
    lib.file("bios/scph5501.bin", b"corrupt dump");
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentHashMismatch);
    assert!(is_blocking(&results, "ps1"));
    let results = sweep_as(&lib.path("bios"), "ps1", "duckstation", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);

    // Beetle PSX's other names work the same way: a corrupt one stops the search...
    let lib = Library::new();
    lib.bios("bios/PS1 US.bin", "scph5501.bin");
    lib.file("bios/scph7003.bin", b"corrupt dump");
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    let beetle = bios_entry(&results, "scph5501.bin");
    assert_eq!(beetle.state, Bios::PresentHashMismatch, "{beetle:#?}");
    assert!(beetle.found_path.as_deref().unwrap_or("").ends_with("scph7003.bin"), "names the file it read");
    assert!(is_blocking(&results, "ps1"));

    // ...and a good one is the BIOS it reads
    let lib = Library::new();
    lib.bios("bios/scph7003.bin", "scph5501.bin");
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);

    // An uppercase name is on Beetle PSX's list on every platform
    let lib = Library::new();
    lib.bios("bios/SCPH5501.BIN", "scph5501.bin");
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "ps1"));

    // Neither searches subfolders
    let lib = Library::new();
    lib.bios("bios/misc/PS1 US.bin", "scph5501.bin");
    let results = sweep_as(&lib.path("bios"), "ps1", "lr-beetle-psx", &rules);
    assert_eq!(bios_entry(&results, "scph5501.bin").state, Bios::PresentWrongPath);
    assert!(is_blocking(&results, "ps1"));

    let lib = Library::new();
    lib.bios("bios/saturn us.bin", "mpr-17933.bin");
    let results = sweep_as(&lib.path("bios"), "saturn", "ymir", &rules);
    assert_eq!(bios_entry(&results, "mpr-17933.bin").state, Bios::PresentValid);
    // Beetle Saturn opens exactly this name (mednafen/ss/ss.c)
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-beetle-saturn", &rules);
    assert_eq!(bios_entry(&results, "mpr-17933.bin").state, Bios::PresentWrongPath);
}

/// Windows filenames ignore case, so an emulator asking for mpr-17933.bin opens
/// MPR-17933.BIN. Romio's path comparison has to agree.
#[cfg(windows)]
#[test]
fn filename_case_does_not_matter_on_windows() {
    let rules = fixture_bios_rules();
    let lib = Library::new();
    lib.bios("bios/MPR-17933.BIN", "mpr-17933.bin");
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-beetle-saturn", &rules);
    let saturn = bios_entry(&results, "mpr-17933.bin");
    assert_eq!(saturn.state, Bios::PresentValid, "{saturn:#?}");
    assert_eq!(saturn.rename_from, None);

    // A first-existing emulator too: the same file, whatever the spelling
    let lib = Library::new();
    lib.bios("bios/KRONOS/SATURN_BIOS.BIN", "saturn_bios.bin");
    let results = sweep_as(&lib.path("bios"), "saturn", "lr-kronos", &rules);
    assert_eq!(bios_entry(&results, "saturn_bios.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "saturn"));
}

/// A rebuilt zip changes its hash, so a different hash is only a warning where the core
/// reads the file. A zip the core can't find is misplaced whatever its hash.
#[test]
fn neogeo_zip_location_matters_whatever_its_hash() {
    let rules = fixture_bios_rules();
    let at = |place: &str, known_bytes: bool| {
        let lib = Library::new();
        std::fs::create_dir_all(lib.path("bios")).unwrap();
        if known_bytes { lib.bios(place, "neogeo.zip"); } else { lib.file(place, b"rebuilt zip"); }
        let results = sweep(&lib.path("bios"), "retrobat", &rules);
        (bios_entry(&results, "neogeo.zip").state.clone(), is_blocking(&results, "neogeo"))
    };

    assert_eq!(at("bios/neogeo.zip", true), (Bios::PresentValid, false));
    assert_eq!(at("bios/neogeo.zip", false), (Bios::PresentHashMismatch, false));
    assert_eq!(at("roms/neogeo/neogeo.zip", false), (Bios::PresentHashMismatch, false));
    assert_eq!(at("bios/misc/neogeo.zip", true), (Bios::PresentWrongPath, true));
    assert_eq!(at("bios/misc/neogeo.zip", false), (Bios::PresentWrongPath, true));

    // Found on a real RetroBat drive: a different version where FBNeo reads it, plus a
    // recognised copy in MAME's folder. FBNeo has a BIOS, so this warns and doesn't block.
    let lib = Library::new();
    lib.file("bios/neogeo.zip", b"another romset version");
    lib.bios("bios/mame/neogeo.zip", "neogeo.zip");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    let neogeo = bios_entry(&results, "neogeo.zip");
    assert_eq!(neogeo.state, Bios::PresentHashMismatch, "{neogeo:#?}");
    assert!(neogeo.found_path.as_deref().unwrap_or("").ends_with("neogeo.zip"));
    assert!(!neogeo.found_path.as_deref().unwrap_or("").contains("mame"), "names the file FBNeo reads");
    assert!(!is_blocking(&results, "neogeo"));
}

/// Found on a real RetroBat drive: PCSX2 boots any PS2 BIOS in its folder, so a valid
/// one must not block just because it isn't the one file a rule happens to name.
#[test]
fn any_recognised_ps2_bios_is_enough() {
    let mut rules = fixture_bios_rules();
    // Fixture hash stands in for the revisions the shipped rule lists
    rules.iter_mut().find(|r| r.filename == "SCPH-70012_BIOS_V12_USA_200.bin").unwrap()
        .known_good_md5.push(fake_md5("scph39001.bin"));

    let lib = Library::new();
    lib.bios("bios/scph39001.bin", "scph39001.bin");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    assert_eq!(bios_entry(&results, "SCPH-70012_BIOS_V12_USA_200.bin").state, Bios::PresentValid);
    assert!(!is_blocking(&results, "ps2"));

    // An unrecognised file isn't a BIOS
    let lib = Library::new();
    lib.file("bios/my-ps2.bin", b"not a bios");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    assert!(is_blocking(&results, "ps2"));
}

/// Hashes from the libretro docs for each core that reads the file.
#[test]
fn shipped_bios_data_has_the_documented_hashes() {
    let rules = db::bios::load_all_rules().unwrap();
    let sega_cd_us = rules.iter().find(|r| r.filename == "bios_CD_U.bin").unwrap();
    for hash in ["854b9150240a198070150e4566ae1290", "2efd74e3232ff260e371b99f84024f7f"] {
        assert!(sega_cd_us.known_good_md5.iter().any(|h| h == hash), "{hash}");
    }
    // PCSX2 takes any PS2 BIOS: the required rule must recognise the optional rule's file too
    let ps2 = rules.iter().find(|r| r.filename == "SCPH-70012_BIOS_V12_USA_200.bin").unwrap();
    assert!(ps2.known_good_md5.len() > 50, "the PS2 revisions in libretro's System.dat");
    let optional = rules.iter().find(|r| r.filename == "scph39001.bin").unwrap();
    assert!(optional.known_good_md5.iter().all(|h| ps2.known_good_md5.contains(h)));
    // Kronos falls back to these files, so their bytes must validate as its BIOS
    let kronos = rules.iter().find(|r| r.filename == "saturn_bios.bin").unwrap();
    for hash in ["af5828fdff51384f99b3c4926be27762", "85ec9ca47d8f6807718151cbcca8b964", "3240872c70984b6cbfda1586cab68dbe"] {
        assert!(kronos.known_good_md5.iter().any(|h| h == hash), "{hash}");
    }
}

/// EmuDeck and RetroDECK run ES-DE, so a rule's ES-DE path must apply to them too.
#[test]
fn emudeck_and_retrodeck_follow_esde_bios_rules() {
    let lib = Library::new();
    let bios_root = lib.path("Emulation/bios");
    lib.bios("Emulation/bios/esde-only/disksys.rom", "disksys.rom");
    let mut rules = fixture_bios_rules();
    rules.iter_mut().find(|r| r.filename == "disksys.rom").unwrap()
        .frontend_paths.insert("esde".into(), "esde-only/".into());

    for frontend in ["emudeck", "retrodeck"] {
        let results = sweep(&bios_root, frontend, &rules);
        assert_eq!(bios_entry(&results, "disksys.rom").state, Bios::PresentValid, "{frontend}");
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

    // A bad EU PS1 dump under the right name, and a good Saturn BIOS under the wrong name
    lib.bios("bios/scph5502.bin", "scph5502-overdump");
    lib.bios("bios/Saturn US (backup).bin", "mpr-17933.bin");

    let results = sweep(&lib.path("bios"), "esde", &rules);

    let eu = bios_entry(&results, "scph5502.bin");
    assert_eq!(eu.state, Bios::PresentHashMismatch);
    assert_eq!(eu.bad_dump_label.as_deref(), Some("Overdump (1 MB)"));

    let saturn = bios_entry(&results, "mpr-17933.bin");
    assert_eq!(saturn.state, Bios::PresentWrongPath, "found by hash, not by name");
    assert_eq!(saturn.rename_from.as_deref(), Some("Saturn US (backup).bin"));

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

/// Conditions must say only what the emulators' sources back up
#[test]
fn key_conditions_match_what_the_emulators_accept() {
    let rules = db::format::load_rules().unwrap();
    let condition = |system: &str, ext: &str, emu: &str| -> String {
        let rule = rules.iter()
            .find(|r| r.system == system && r.extension == ext && r.emulator == emu)
            .unwrap_or_else(|| panic!("{system} .{ext} {emu} rule missing"));
        match &rule.support {
            FormatSupport::Conditional { condition } => condition.clone(),
            _ => panic!("{system} .{ext} {emu} must stay conditional"),
        }
    };

    // Eden and Citron only ask for a title key when the content has a rights ID
    for emu in ["eden", "citron"] {
        for ext in ["nsp", "xci"] {
            let text = condition("switch", ext, emu);
            assert!(text.contains("prod.keys") && text.contains("rights ID"), "{emu} .{ext}: {text}");
            assert!(!text.contains("console-specific"), "{emu} .{ext}: {text}");
        }
    }
    // Cemu takes the disc key from keys.txt or a .key file next to the image
    for ext in ["wud", "wux"] {
        let text = condition("wiiu", ext, "cemu");
        assert!(text.contains("keys.txt") && text.contains(".key file"), ".{ext}: {text}");
    }
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
        ("roms/pcenginecd/Ys Book I & II.chd", "tg16cd", "lr-beetle-pce"),
        ("roms/pcenginecd/Ys Book I & II.cue", "tg16cd", "lr-beetle-pce-fast"),
    ] {
        assert_eq!(check(rel, system, emulator).state, Fmt::Compatible, "{rel}");
    }

    // Each folder's default emulator, for the formats libraries really hold
    for (rel, system, emulator) in [
        ("roms/nes/a.nes", "nes", "mesen2"),
        ("roms/nes/a.zip", "nes", "mesen2"),
        ("roms/snes/a.sfc", "snes", "snes9x"),
        ("roms/snes/a.zip", "snes", "snes9x"),
        ("roms/n64/a.z64", "n64", "gopher64"),
        ("roms/n64/a.zip", "n64", "gopher64"),
        ("roms/n64dd/a.ndd", "n64dd", "lr-mupen64plus-next"),
        ("roms/gb/a.zip", "gb", "mgba"),
        ("roms/gbc/a.zip", "gbc", "mgba"),
        ("roms/gba/a.zip", "gba", "mgba"),
        ("roms/nds/a.zip", "nds", "melonds"),
        ("roms/megadrive/a.md", "genesis", "lr-genesis-plus-gx"),
        ("roms/megadrive/a.bin", "genesis", "lr-genesis-plus-gx"),
        ("roms/sega32x/a.zip", "sega32x", "lr-picodrive"),
        ("roms/mastersystem/a.zip", "mastersystem", "lr-genesis-plus-gx"),
        ("roms/pcengine/a.zip", "pcengine", "lr-beetle-pce"),
        ("roms/3do/a.chd", "3do", "lr-opera"),
        ("roms/amiga500/a.zip", "amiga", "lr-puae"),
        ("roms/amigacd32/a.zip", "amigacd32", "lr-puae"),
        ("roms/atari2600/a.a26", "atari2600", "lr-stella"),
        ("roms/atari7800/a.a78", "atari7800", "lr-prosystem"),
        ("roms/atari800/a.atr", "atari800", "lr-atari800"),
        ("roms/jaguar/a.zip", "jaguar", "lr-virtualjaguar"),
        ("roms/pokemini/a.zip", "pokemini", "lr-pokemini"),
        ("roms/pico8/a.p8", "pico8", "lr-retro8"),
        ("roms/snes-msu1/a.fig", "snes-msu1", "lr-snes9x"),
        ("roms/pico8/a.p8.png", "pico8", "lr-retro8"),
        ("roms/prboom/a.wad", "prboom", "lr-prboom"),
        ("roms/gzdoom/a.wad", "gzdoom", "gzdoom"),
        ("roms/easyrpg/a.zip", "easyrpg", "lr-easyrpg"),
        ("roms/dos/a.zip", "dos", "lr-dosbox-pure"),
        ("roms/naomi/a.zip", "naomi", "lr-flycast"),
        ("roms/naomi2/a.zip", "naomi2", "lr-flycast"),
        ("roms/atomiswave/a.zip", "atomiswave", "lr-flycast"),
        ("roms/naomi/a.dat", "naomi", "lr-flycast"),
        ("roms/naomi/a.lst", "naomi", "lr-flycast"),
        ("roms/cps1/a.zip", "cps1", "lr-fbneo"),
        ("roms/cps2/a.zip", "cps2", "lr-fbneo"),
        ("roms/cps3/a.zip", "cps3", "lr-fbneo"),
        ("roms/fbneo/a.zip", "fbneo", "lr-fbneo"),
        ("roms/neogeo/a.zip", "neogeo", "lr-fbneo"),
        ("roms/mame/a.zip", "arcade", "mame"),
        ("roms/neogeocd/a.chd", "neogeocd", "lr-neocd"),
        ("roms/psx/a.cue", "ps1", "duckstation"),
        ("roms/psx/a.pbp", "ps1", "lr-beetle-psx"),
        ("roms/saturn/a.cue", "saturn", "ymir"),
        ("roms/dreamcast/a.gdi", "dreamcast", "flycast"),
        ("roms/segacd/a.cue", "segacd", "lr-genesis-plus-gx"),
    ] {
        assert_eq!(check(rel, system, emulator).state, Fmt::Compatible, "{rel}");
    }

    // RetroArch unpacks only one file, so an archived disc image isn't a yes. Romio doesn't guess.
    for (rel, system, emulator) in [
        ("roms/neogeocd/b.7z", "neogeocd", "lr-neocd"),
        ("roms/segacd/b.zip", "segacd", "lr-genesis-plus-gx"),
        ("roms/3do/b.zip", "3do", "lr-opera"),
        // These emulators' sources list neither format
        ("roms/n64dd/b.zip", "n64dd", "lr-mupen64plus-next"),
        ("roms/snes-msu1/b.rom", "snes-msu1", "lr-snes9x"),
        // .dmg is too often a macOS disk image to count as a game in every folder
        ("roms/gb/b.dmg", "gb", "lr-gambatte"),
        ("roms/gbc/b.dmg", "gbc", "lr-gambatte"),
    ] {
        assert_eq!(check(rel, system, emulator).state, Fmt::Unknown, "{rel}");
    }

    // Disk games need the core's subsystem, so a plain yes would mislead
    let ndd = check("roms/n64dd/c.ndd", "n64dd", "lr-mupen64plus-next");
    assert_eq!(ndd.state, Fmt::Compatible);
    assert!(ndd.condition.unwrap_or_default().contains("subsystem"));

    // PPSSPP can't read .zso; Romio says so and offers no rename
    let zso = check("roms/psp/Patapon.zso", "psp", "ppsspp");
    assert_eq!(zso.state, Fmt::FormatIncompatible);
    assert!(zso.notes.unwrap_or_default().contains(".cso"), "points to a format that works");

    // Flycast runs any raw .dat or .lst as NAOMI, so they only suit that system
    for system in ["naomi2", "atomiswave"] {
        for ext in ["dat", "lst"] {
            let raw = check(&format!("roms/{system}/a.{ext}"), system, "lr-flycast");
            assert_eq!(raw.state, Fmt::FormatIncompatible, "{system} .{ext}");
            assert!(raw.notes.unwrap_or_default().contains("MAME .zip"), "says what to use instead");
        }
    }
    // A .lst is only an index
    let lst = rules.iter().find(|r| r.system == "naomi" && r.extension == "lst").unwrap();
    assert!(matches!(&lst.support, romio_lib::models::format::FormatSupport::Conditional { condition }
        if condition.contains("must sit beside it")));

    // .cia installs into Azahar rather than booting: allowed, with that warning
    let cia = check("roms/n3ds/Pokemon Y.cia", "3ds", "azahar");
    assert_eq!(cia.state, Fmt::Compatible);
    assert!(cia.condition.unwrap_or_default().starts_with("Azahar installs"));
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

/// An unplugged drive or a locked folder must not look like a smaller library: the scan
/// fails, naming the path, so the command layer never replaces the saved results.
#[test]
fn unreadable_library_root_fails_the_scan() {
    let lib = Library::new();
    let scan = |root: std::path::PathBuf| scan_roots(&[root], Arc::new(AtomicBool::new(false)), |_| {});

    let error = scan(lib.path("roms")).expect_err("missing root").to_string();
    assert!(error.contains("roms"), "names the path: {error}");

    lib.game("roms/psx/Ape Escape (USA).chd");
    lib.game("roms/n64/Mario Kart 64 (USA).z64");
    assert_eq!(scan(lib.path("roms")).unwrap().len(), 2);

    // An empty library that really is empty still scans fine
    std::fs::create_dir_all(lib.path("empty")).unwrap();
    assert_eq!(scan(lib.path("empty")).unwrap().len(), 0);

    // One locked folder would silently shrink the results
    let Some(_locked) = deny_read(&lib.path("roms/n64")) else {
        eprintln!("this OS ignores read denial (running as root?); skipping");
        return;
    };
    let error = scan(lib.path("roms")).expect_err("locked folder").to_string();
    assert!(error.contains("n64"), "names the path: {error}");
}

/// A BIOS folder Romio can't read says nothing about which files are missing.
#[test]
fn unreadable_bios_root_is_an_error_not_missing_files() {
    let lib = Library::new();
    let rules = fixture_bios_rules();
    let assert_errored = |results: &[BiosSystemResult]| {
        let ps1 = results.iter().find(|s| s.system == "ps1").unwrap();
        assert!(ps1.errored, "{ps1:#?}");
        assert!(ps1.entries.is_empty(), "no verdicts on files it couldn't look for");
        assert!(ps1.error.as_deref().unwrap_or("").contains("bios"), "says what failed: {ps1:#?}");
    };

    assert_errored(&sweep(&lib.path("bios"), "retrobat", &rules));

    lib.bios("bios/scph5501.bin", "scph5501.bin");
    let results = sweep(&lib.path("bios"), "retrobat", &rules);
    let ps1 = results.iter().find(|s| s.system == "ps1").unwrap();
    assert!(!ps1.errored);
    assert_eq!(ps1.error, None);

    let Some(_locked) = deny_read(&lib.path("bios")) else {
        eprintln!("this OS ignores read denial (running as root?); skipping");
        return;
    };
    assert_errored(&sweep(&lib.path("bios"), "retrobat", &rules));
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

/// The Format screen's "auto" emulator comes from the emulator matrix. A system with
/// format rules but no matrix entry gets emulator "unknown", and none of its rules fire.
#[test]
fn every_system_with_format_rules_has_a_recommended_emulator() {
    let matrix = db::emulator::load_emulator_matrix().unwrap();
    let rules = db::format::load_rules().unwrap();
    let mut missing: Vec<&str> = rules.iter()
        .map(|r| r.system.as_str())
        .filter(|s| !matrix.iter().any(|m| m.system == *s))
        .collect();
    missing.dedup();
    assert!(missing.is_empty(), "no emulator_matrix entry for: {missing:?}");
}

/// Format Check lists a file wherever it could be a game: artwork and a few formats
/// that are rarely games elsewhere stay out, but a wrong Unknown row beats a missing game.
#[test]
fn rule_notes_are_written_for_users_not_source_readers() {
    for rule in db::format::load_rules().unwrap() {
        let notes = rule.notes.unwrap_or_default();
        let cites_source = [".cpp", ".cc", "src/", "Source/", "Core/", "pcsx2/", "README"]
            .iter().any(|s| notes.contains(s));
        assert!(!cites_source, "{} .{}: {notes}", rule.system, rule.extension);
    }
}

#[test]
fn vita3k_formats_it_installs_are_conditional() {
    let lib = Library::new();
    let rules = db::format::load_rules().unwrap();
    for name in ["roms/psvita/Game.vpk", "roms/psvita/Game.zip"] {
        let result = check_format(&lib.game(name), &rules, "psvita", "vita3k", "retrobat");
        assert!(result.condition.is_some(), "{name}: {result:#?}");
    }
}

#[test]
fn format_check_lists_a_systems_own_formats_not_stray_files() {
    let lib = Library::new();
    for g in [
        // Strays: artwork, and formats that belong to other systems
        "roms/psx/Ape Escape.chd",
        "roms/psx/cover.png",
        "roms/psx/notes.car",
        "roms/psx/notes.ids",
        "roms/psx/notes.min",
        "roms/psx/notes.bs",
        "roms/psx/notes.dat",
        "roms/psx/notes.lst",
        // Legitimate, including through a folder alias
        "roms/atari800/Star Raiders.car",
        "roms/nds/Mario Kart DS.ids",
        "roms/pokemini/Pichu Bros.min",
        "roms/sfc/BS Zelda.bs",
        "roms/naomi/Marvel vs Capcom 2.dat",
        "roms/atomiswave/Dolphin Blue.lst",
        "roms/pico8/celeste.p8.png",
        "roms/easyrpg/Yume.zip",
        // No rules for this system yet, so its formats can't be ruled out. Artwork still can.
        "roms/satellaview/BS Zelda.bs",
        "roms/satellaview/box.png",
        // Partial rules aren't a full format list: lr-snes9x accepts all of these
        "roms/snes-msu1/Zelda MSU.fig",
        "roms/snes-msu1/Zelda MSU.swc",
        "roms/snes-msu1/Zelda MSU.bs",
        // A format another system uses, not named by this system's rules
        "roms/tg16cd/Ys.mds",
        // TIC-80 saves carts as .png; standalone TIC-80 loads them
        "roms/tic80/8bit panda.png",
    ] {
        lib.game(g);
    }
    // EasyRPG games are folders; only that system's folder holds them
    lib.game("roms/easyrpg/Ib.easyrpg/RPG_RT.ldb");
    lib.game("roms/easyrpg/saves/slot1.lsd");
    lib.game("roms/psx/Stray.easyrpg/RPG_RT.ldb");

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let listed = |name: &str| -> Vec<String> {
        let folder = folders.iter().find(|f| f.name == name).unwrap_or_else(|| panic!("no folder {name}"));
        folder.files.iter()
            .map(|f| std::path::Path::new(f).file_name().unwrap().to_string_lossy().to_string())
            .collect()
    };

    assert_eq!(listed("psx"), ["Ape Escape.chd"]);
    assert_eq!(listed("atari800"), ["Star Raiders.car"]);
    assert_eq!(listed("nds"), ["Mario Kart DS.ids"]);
    assert_eq!(listed("pokemini"), ["Pichu Bros.min"]);
    assert_eq!(listed("sfc"), ["BS Zelda.bs"], "sfc is an alias for snes");
    assert_eq!(listed("naomi"), ["Marvel vs Capcom 2.dat"]);
    assert_eq!(listed("atomiswave"), ["Dolphin Blue.lst"]);
    assert_eq!(listed("pico8"), ["celeste.p8.png"]);
    assert_eq!(listed("easyrpg"), ["Ib.easyrpg", "Yume.zip"]);
    assert_eq!(listed("satellaview"), ["BS Zelda.bs"]);
    assert_eq!(listed("snes-msu1"), ["Zelda MSU.bs", "Zelda MSU.fig", "Zelda MSU.swc"]);
    assert_eq!(listed("tg16cd"), ["Ys.mds"]);
    assert_eq!(listed("tic80"), ["8bit panda.png"]);
}

#[test]
fn a_cue_and_bin_disc_reads_as_one_compatible_game() {
    let lib = Library::new();
    lib.file("roms/psx/Disc.cue", b"FILE \"Disc.bin\" BINARY\n  TRACK 01 MODE2/2352\n");
    lib.game("roms/psx/Disc.bin");

    let rules = db::format::load_rules().unwrap();
    let folders = list_system_folders(lib.root(), &rules).unwrap();
    let files = &folders.iter().find(|f| f.name == "psx").unwrap().files;

    assert_eq!(files.len(), 1, "{files:?}");
    let result = check_format(std::path::Path::new(&files[0]), &rules, "ps1", "duckstation", "retrobat");
    assert_eq!(result.extension, "cue");
    assert_eq!(result.state, romio_lib::models::artifact::FormatCompatibilityState::Compatible);
}

#[test]
fn format_check_finds_games_in_subfolders_like_the_frontends_do() {
    let lib = Library::new();
    // A disc game in its own folder reads as one game, at any depth
    lib.file("roms/dreamcast/Disc A/Disc A.gdi", b"2\n1 0 4 2352 track01.bin 0\n2 450 0 2352 track02.raw 0\n");
    lib.game("roms/dreamcast/Disc A/track01.bin");
    lib.game("roms/dreamcast/Disc A/track02.raw");
    lib.file("roms/psx/Disc B/Disc B.cue", b"FILE \"Disc B.bin\" BINARY\n  TRACK 01 MODE2/2352\n");
    lib.game("roms/psx/Disc B/Disc B.bin");
    lib.game("roms/psx/Racing/Disc C/Disc C.chd");
    // A sheet only speaks for its own folder, so this top-level file stays listed
    lib.file("roms/psx/Disc D/Disc D.cue", b"FILE \"Loose.bin\" BINARY\n  TRACK 01 MODE2/2352\n");
    lib.game("roms/psx/Loose.bin");
    // Folders the frontends skip, plus saves
    for skipped in [
        "media", "Media", "medias", "images", "manuals", "videos", "assets", "html_arrm", "bezels",
        "fonts", "logs", "screenshots", "artwork", "saves", "downloaded_images", ".hidden",
    ] {
        lib.game(&format!("roms/psx/{skipped}/Skipped.chd"));
    }
    lib.game("roms/psx/Texture Pack/Skipped.chd");
    lib.game("roms/psx/Texture Pack/noload.txt");
    // A folder named like a game format is one game, wherever it sits
    lib.game("roms/easyrpg/RPG/Ib.easyrpg/game.zip");
    lib.game("roms/dreamcast/Disc E.cue/Disc E.cue");
    lib.game("roms/dreamcast/Disc E.cue/Disc E.gdi");
    // A playlist folder is not, as playlists aren't games: its discs are checked like loose ones
    lib.game("roms/saturn/Disc F.m3u/Disc F.m3u");
    lib.game("roms/saturn/Disc F.m3u/Disc F (Disc 1).chd");
    // Installed game trees are full of files with ROM-like extensions
    lib.game("roms/ps3/Game.ps3/PS3_GAME/USRDIR/EBOOT.BIN");
    lib.game("roms/dos/Game/readme.md");
    lib.game("roms/windows/Game/setup.iso");
    lib.game("roms/mame/game/game.chd");

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let listed = |name: &str| -> Vec<String> {
        let folder = folders.iter().find(|f| f.name == name).unwrap_or_else(|| panic!("no folder {name}"));
        let mut names: Vec<String> = folder.files.iter()
            .map(|f| std::path::Path::new(f).file_name().unwrap().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    };

    assert_eq!(listed("dreamcast"), ["Disc A.gdi", "Disc E.cue"]);
    assert_eq!(listed("psx"), ["Disc B.cue", "Disc C.chd", "Disc D.cue", "Loose.bin"]);
    assert_eq!(listed("easyrpg"), ["Ib.easyrpg"]);
    assert_eq!(listed("saturn"), ["Disc F (Disc 1).chd"]);
    for tree in ["ps3", "dos", "windows", "mame"] {
        assert!(listed(tree).is_empty(), "{tree}: {:?}", listed(tree));
    }
}

#[test]
fn an_unreadable_subfolder_is_reported_and_keeps_the_games_already_found() {
    let lib = Library::new();
    lib.game("roms/psx/Readable.chd");
    lib.game("roms/psx/Readable Folder/Nested.chd");
    let locked = lib.path("roms/psx/Locked");
    lib.game("roms/psx/Locked/Hidden.chd");
    let Some(_guard) = common::deny_read(&locked) else {
        eprintln!("can't deny read here; skipping");
        return;
    };

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let psx = folders.iter().find(|f| f.name == "psx").unwrap();
    assert!(psx.error.is_some(), "a locked subfolder must not look like fewer games");
    assert_eq!(psx.files.len(), 2, "{:?}", psx.files);
}

#[cfg(windows)]
#[test]
fn a_junction_back_to_a_parent_does_not_loop_or_repeat_games() {
    let lib = Library::new();
    lib.game("roms/psx/Racing/Disc.chd");
    let link = lib.path("roms/psx/Racing/Loop");
    let made = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(lib.path("roms/psx"))
        .output()
        .unwrap();
    assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let psx = folders.iter().find(|f| f.name == "psx").unwrap();
    assert_eq!(psx.files.len(), 1, "{:?}", psx.files);
    std::fs::remove_dir(&link).unwrap();
}

#[test]
fn nested_files_are_judged_like_loose_ones_outside_installed_trees() {
    let lib = Library::new();
    lib.game("roms/tic80/Carts/Cart.png");
    lib.game("roms/satellaview/Carts/Cart.bs");
    lib.game("roms/dreamcast/Disc/Disc.iso");
    lib.game("roms/psx/Bare/Bare.bin");
    // A sheet still speaks for its own folder's tracks
    lib.file("roms/saturn/Disc/Disc.cue", b"FILE \"Disc.bin\" BINARY
  TRACK 01 MODE1/2352
");
    lib.game("roms/saturn/Disc/Disc.bin");
    lib.game("roms/saturn/Other/Disc.bin");

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let listed = |name: &str| -> Vec<String> {
        let root = lib.path("roms").join(name);
        let folder = folders.iter().find(|f| f.name == name).unwrap_or_else(|| panic!("no folder {name}"));
        folder.files.iter()
            .map(|f| std::path::Path::new(f).strip_prefix(&root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
            .collect()
    };

    assert_eq!(listed("tic80"), ["Carts/Cart.png"]);
    assert_eq!(listed("satellaview"), ["Carts/Cart.bs"]);
    assert_eq!(listed("dreamcast"), ["Disc/Disc.iso"]);
    assert_eq!(listed("psx"), ["Bare/Bare.bin"]);
    assert_eq!(listed("saturn"), ["Disc/Disc.cue", "Other/Disc.bin"], "only the sheet's own folder hides its track");
}

#[test]
fn skipped_folders_stay_out_even_when_named_like_a_game() {
    let lib = Library::new();
    lib.game("roms/psx/downloaded_x.chd/Skipped.chd");
    lib.game("roms/psx/Disc.cue/Skipped.cue");
    lib.game("roms/psx/Disc.cue/noload.txt");
    lib.game("roms/psx/Racing/Disc.cue/Skipped.cue");
    lib.game("roms/psx/Racing/Disc.cue/noload.txt");
    lib.game("roms/psx/Listed.chd/Inner.chd");

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let psx = folders.iter().find(|f| f.name == "psx").unwrap();
    let names: Vec<_> = psx.files.iter()
        .map(|f| std::path::Path::new(f).file_name().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(names, ["Listed.chd"]);
}

#[cfg(windows)]
fn junction(link: &std::path::Path, target: &std::path::Path) {
    let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(link).arg(target).output().unwrap();
    assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
}

#[cfg(windows)]
#[test]
fn a_link_out_of_the_system_folder_is_reported_not_walked() {
    let lib = Library::new();
    lib.game("roms/psx/Own.chd");
    lib.game("roms/saturn/Other.chd");
    junction(&lib.path("roms/psx/Linked"), &lib.path("roms/saturn"));

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let psx = folders.iter().find(|f| f.name == "psx").unwrap();
    assert_eq!(psx.files.len(), 1, "{:?}", psx.files);
    assert!(psx.error.is_some(), "a game left unchecked must say so");
    let saturn = folders.iter().find(|f| f.name == "saturn").unwrap();
    assert_eq!((saturn.files.len(), saturn.error.is_none()), (1, true));
    std::fs::remove_dir(lib.path("roms/psx/Linked")).unwrap();
}

#[cfg(windows)]
#[test]
fn a_system_folder_that_is_itself_a_link_still_works() {
    let lib = Library::new();
    lib.game("elsewhere/ps2/Racing/Disc.chd");
    lib.game("roms/psx/Own.chd");
    junction(&lib.path("roms/ps2"), &lib.path("elsewhere/ps2"));

    let folders = list_system_folders(lib.root(), &db::format::load_rules().unwrap()).unwrap();
    let ps2 = folders.iter().find(|f| f.name == "ps2").unwrap();
    assert_eq!((ps2.files.len(), ps2.error.as_deref()), (1, None), "{:?}", ps2.files);
    std::fs::remove_dir(lib.path("roms/ps2")).unwrap();
}
