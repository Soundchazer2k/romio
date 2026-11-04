# Gemini QA

Reserved for Gemini's findings: user-journey testing, visual QA and compatibility research. Scope and commit are in [CURRENT.md](CURRENT.md).

Use your own working copy. Report findings here; don't change application code.

<!-- Findings go below this line. -->

## Test Environment & Scope

| Item | Value |
|:--|:--|
| **Tested Commit** | `f5d07b13e4802ac80ed53e5ec427be36891d10d6` (`fix/saves-bios-polish`, base `d9e1e2880d959c6deb2b2ff47dd2145f629ec831`) |
| **OS / Platform** | Windows (`win32-x64`, Node `v24.21.0`, Vite `8.3.5`, Vitest `5.1.0`, Rust `cargo test`) |
| **Working Copy** | Isolated detached-HEAD working copy verified at `f5d07b13e4802ac80ed53e5ec427be36891d10d6` using disposable `TempDir` fake libraries. No real ROMs, BIOS dumps, saves, or `%APPDATA%` emulator configs were modified. |

### Test Execution Breakdown (Native vs. Mocked)

Per QA rules, mocked browser/DOM checks are strictly distinguished from native Rust/desktop checks:

1. **Native Rust Engine & Shipped Rules Database (`cargo test` against `romio_lib`):**
   - Ran all **43 unit tests** + **11 shipped scenario tests** (`src-tauri/tests/scenarios.rs`) + **6 new QA edge-case scenario tests** against the real Rust engine and shipped `src-tauri/data/*.json` files using disposable `tempfile::TempDir` libraries and Windows `icacls` permission-denial guards (`deny_read`).
2. **Mocked Frontend / Full User-Journey DOM & Build (`vitest` `jsdom` + `vite build`):**
   - Ran all **46 shipped unit/component tests** + **3 full `<App />` user-journey tests** (Curator, Handheld, Rescuer) exercising `WelcomeScreen`, `ProjectsScreen`, `PreflightScreen`, `DashboardScreen`, `BiosScreen`, `FormatScreen`, `SavesScreen`, `Sidebar`, and `RomioCompanion` with mocked Tauri IPC.
   - Verified production frontend bundle compilation via `vite build` (passes in 621 ms).
3. **What Could Not Be Checked:**
   - **Live Tauri WebView2 window & Playwright TCP server (`127.0.0.1:1444` / CDP `:9333`):** Local TCP port binding inside the test sandbox was blocked (`EPERM` / exit code `4294963248`), so UI journeys were verified via full `<App />` `jsdom` rendering and source/token inspection rather than live WebView2 screenshots.
   - **Native OS Folder Picker (`@tauri-apps/plugin-dialog`):** Mocked in frontend tests; not exercised interactively.
   - **Real Hardware BIOS Dumps:** Tested via `fixture_bios_rules()` (which preserves all shipped rules, paths, regions, and requirements while substituting legal fixture hashes) and unit tests.
   - **Save Migration Execution & Format Fix Execution:** Both remain intentional UI/backend stubs (`Execute Migration — Execution not yet available` in `SavesScreen.tsx:476-477`; `execute_migration` returns `Err(MigrationBlocker::CheckpointRequired)` in `commands/save.rs:130-135`; `FormatFixPlanModal.tsx:20-23` logs a stub notice).
   - **Cross-Platform Desktop Packaging:** `pnpm tauri build` installer generation and live Linux/Steam Deck (`$XDG_DATA_HOME` tested via `SaveAnchors` injection only) and macOS host environments were not run.

---

## PR #29 Requirements Verification

| # | Requirement | Verdict | Summary |
|:--|:--|:--|:--|
| **1** | A valid BIOS for one region must not leave a system blocked because other regions' files are missing. A bad dump must not count as valid. | **PARTIAL / FAIL** | Works for `ps1`, `segacd`, and JP `saturn`, **but fails for US `saturn`** (a valid `mpr-17933.bin` still leaves `saturn` `Blocking` because `saturn_bios.bin` for Kronos is also marked `region: "US"` and `requirement: "required"`). Additionally, **bad dumps (`PRESENT_HASH_MISMATCH`) and wrong-path files (`PRESENT_WRONG_PATH`) do not set `blocking: true`** when no required file is `MISSING_REQUIRED`, causing `DashboardScreen` to report `"All valid"` and `BiosScreen` to report `"0 missing"`. |
| **2** | The Saves at-risk banner must include conflicts (saves at both the old and new paths). | **PASS** | `SavesScreen.tsx:44-45` filters `migration_needed` and `conflict_detected` into `atRisk`, rendering `{atRisk.length} save root(s) at risk` with `"Migrate, or review the conflicts, before updating."` |
| **3** | One file must read `"1 file"`, not `"1 files"`. | **PASS** | Verified in `SaveRootCard` (`SavesScreen.tsx:262`), `MigrationPlanModal` checkpoint summary (`SavesScreen.tsx:430`), and `FormatSystemRow` (`FormatSystemRow.tsx:59`). |
| **4** | The Saves root field must not clear when the user leaves the screen. | **PARTIAL / FAIL** | Pre-fills from `activeProject?.libraryRoots?.[0] ?? ""` (`SavesScreen.tsx:21`), which survives screen changes **only for the default first library root**. Any path typed by the user into `Frontend installation root` is stored in local component `useState` and is **lost** upon navigating to another screen and returning. |

---

## Findings

### 1. [HIGH] Valid US Sega Saturn BIOS (`mpr-17933.bin`) still leaves Saturn `Blocking` (Violates PR #29 Req 1)

- **Location:** `src-tauri/src/engine/bios_validator.rs:58-63`, `src-tauri/data/bios_rules.json:101-127`
- **Steps to Reproduce:**
  1. Configure a project for any frontend (`esde`, `retrobat`, `batocera`) with the default Saturn emulator (`lr-beetle-saturn`) or `ymir`.
  2. Place a valid US Sega Saturn BIOS `mpr-17933.bin` (`3240872c70984b6cbfda1586cab68dbe`) at `bios/mpr-17933.bin`.
  3. Run BIOS validation (`run_sweep` / `validate_system_bios`).
- **Expected Behavior:**
  - Because `mpr-17933.bin` satisfies the US region requirement for `lr-beetle-saturn` / `ymir`, the `"US"` region should be complete, `sega_101.bin` (`JP`) should downgrade from `MISSING_REQUIRED` to `MISSING_OPTIONAL`, and `saturn.blocking` should be `false`.
- **Actual Behavior:**
  - `saturn.blocking` remains **`true`**, and `sega_101.bin` remains **`MISSING_REQUIRED`**.
- **Evidence & Root Cause:**
  - `bios_rules.json` defines **two** `"required"` rules with `"region": "US"` for `saturn`: `mpr-17933.bin` (`defaultPath: ""`, for Beetle Saturn) and `saturn_bios.bin` (`defaultPath: "kronos/"`, for `lr-kronos`).
  - `region_complete("US")` in `bios_validator.rs:58-60` requires `.all(|(_, e)| e.state == BiosValidationState::PresentValid)` across every `Required` rule in region `"US"`. Because `saturn_bios.bin` is evaluated even when the active emulator is `lr-beetle-saturn` (not `lr-kronos`), `saturn_bios.bin` is `MissingRequired`, making `region_complete("US")` `false`.
  - Conversely, `JP` only has one rule (`sega_101.bin`), so a JP-only BIOS unblocks Saturn while a US-only BIOS does not.

---

### 2. [HIGH] Bad dumps (`PRESENT_HASH_MISMATCH`) and wrong-path BIOS files (`PRESENT_WRONG_PATH`) do not set `blocking: true`, causing `"0 missing"` on `BiosScreen` and `"All valid"` on `DashboardScreen`

- **Location:** `src-tauri/src/engine/bios_validator.rs:73-74`, `src/components/bios/BiosScreen.tsx:248-254`, `src/components/dashboard/DashboardScreen.tsx:18-30`
- **Steps to Reproduce:**
  1. **Single-rule required system (e.g., Xbox `mcpx_1.0.bin`, FDS `disksys.rom`, TG16-CD `syscard3.pce`, 3DO `panafz10.bin`, Neo Geo `neogeo.zip`):** Place a known bad dump or corrupted file at `bios/mcpx_1.0.bin` (`PRESENT_HASH_MISMATCH`), or place `neogeo.zip` at `Emulation/bios/neogeo.zip` instead of `roms/arcade/neogeo.zip` on ES-DE (`PRESENT_WRONG_PATH`).
  2. **Multi-region system (`ps1`, `segacd`):** Place corrupted files (`PRESENT_HASH_MISMATCH`) for all three regional BIOSes (`scph5500.bin`, `scph5501.bin`, `scph5502.bin`).
  3. Open `DashboardScreen` and `BiosScreen`.
- **Expected Behavior:**
  - A system whose required BIOS is corrupted (`PRESENT_HASH_MISMATCH`) or in a folder where the emulator cannot find it (`PRESENT_WRONG_PATH`) when no region is valid must be marked `blocking: true`.
  - `BiosScreen` and `DashboardScreen` must never report `"0 missing"` or `"All valid"` when a BIOS has a hash mismatch or wrong path.
- **Actual Behavior:**
  - `bios_validator.rs:73-74` computes:
    ```rust
    let blocking = rules.iter().zip(&entries).any(|(rule, entry)|
        rule.requirement == BiosRequirement::Required && entry.state == BiosValidationState::MissingRequired);
    ```
    Because the entry state is `PresentHashMismatch` or `PresentWrongPath` (not `MissingRequired`), **`result.blocking` is `false`**.
  - On `BiosScreen.tsx:248-254`, when `!result.errored && !result.blocking && !allValid`, the row badge counts only `MISSING_REQUIRED` and `MISSING_OPTIONAL`, rendering **`"0 missing"`** in amber on the collapsed system row.
  - On `DashboardScreen.tsx:18-30`, `biosBadge()` checks only `blockingCount`, `erroredCount`, and `missingCount` (`MISSING_REQUIRED | MISSING_OPTIONAL`). When those are `0`, the Dashboard BIOS card displays **`"All valid"` in green** (`CheckCircle2`) even though `mcpx_1.0.bin` is a known bad dump or `neogeo.zip` is in the wrong directory.

---

### 3. [HIGH] `scan_bios_directory` keys `found_files` by `HashMap<MD5, PathBuf>`, so duplicate/backup BIOS copies overwrite valid paths

- **Location:** `src-tauri/src/engine/bios_validator.rs:85-110`
- **Steps to Reproduce:**
  1. Place a valid `scph5501.bin` at the expected path `bios/scph5501.bin`.
  2. Also keep a backup copy with the same contents at `bios/z_backup/scph5501.bin` (or follow `bios_rules.json`'s Saturn note and copy `mpr-17933.bin` to `bios/kronos/saturn_bios.bin`).
  3. Validate BIOS.
- **Expected Behavior:**
  - Because `bios/scph5501.bin` exists at the exact expected path with a valid MD5, `scph5501.bin` must be reported as `PRESENT_VALID`.
  - If `bios/kronos/saturn_bios.bin` exists on disk with the wrong MD5 for that rule, it should be reported as `PRESENT_HASH_MISMATCH`, not `MISSING_REQUIRED`.
- **Actual Behavior:**
  - `scan_bios_directory` inserts `(hash, path)` into a single-value `HashMap<String, PathBuf>`. When `WalkDir` visits `bios/z_backup/scph5501.bin` after `bios/scph5501.bin`, it overwrites the entry for `hash`, causing `evaluate_rule` to see only `bios/z_backup/scph5501.bin` and flag `scph5501.bin` as **`PRESENT_WRONG_PATH`** (and `ps1.blocking = true`).
  - Conversely, when `bios/kronos/saturn_bios.bin` has the same bytes as `bios/mpr-17933.bin`, `bios/mpr-17933.bin` overwrites `bios/kronos/saturn_bios.bin` in `found_files`, so `evaluate_rule` no longer sees `saturn_bios.bin` in `found_files.values()` and reports `saturn_bios.bin` as **`MISSING_REQUIRED`** instead of `PRESENT_HASH_MISMATCH`.

---

### 4. [HIGH] `scan_roots` (`Scan Library`) and `scan_bios_directory` (`Revalidate BIOS`) silently ignore unreadable or missing root paths

- **Location:** `src-tauri/src/engine/scanner.rs:84-88`, `src-tauri/src/engine/bios_validator.rs:88-108`
- **Steps to Reproduce:**
  1. **Library Scan:** Create a project whose library root is an unplugged drive (`Z:\RetroBat`) or a read-denied directory (`icacls <dir> /deny <user>:(RD)`), then click **Scan Library** on `DashboardScreen`.
  2. **BIOS Sweep:** Configure `biosRoot` to a read-denied directory containing valid BIOS files (or a non-existent path), then click **Revalidate BIOS** on `BiosScreen`.
- **Expected Behavior:**
  - Consistent with `list_system_folders` (Format screen) and `discover_save_roots` (Saves screen), unreadable or missing roots should surface an explicit error/unreadable state rather than masquerading as an empty directory or wiping previous scan stats.
- **Actual Behavior:**
  - `scanner.rs:87` uses `WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok())`, silently discarding all I/O and permission errors. `scan_library` succeeds with `0 Total Files`, `0 Blocking`, `0 Errors`, and overwrites the project's persisted `artifacts` and `scan_stats` in SQLite.
  - `bios_validator.rs:88-108` returns `Ok(empty_index)` when `!root.exists()`, ignores directory traversal errors via `.filter_map(|e| e.ok())`, and skips unreadable files via `Err(_) => { /* skip unreadable files */ }`. Every system returns `errored: false` and reports all required BIOS files as `MISSING_REQUIRED`. (As a result, `BiosSystemResult.errored` is dead code in normal operation.)

---

### 5. [MEDIUM] Hand-typed `Frontend installation root` on `SavesScreen` is lost when switching screens, and multi-root projects ignore `libraryRoots[1..]` (PR #29 Req 4)

- **Location:** `src/components/saves/SavesScreen.tsx:21`
- **Steps to Reproduce:**
  1. Open a project (e.g., `libraryRoots: ["D:\\RomsOnly"]`).
  2. Navigate to **Save Migration** (`SavesScreen`).
  3. Type `C:\RetroBat` into **Frontend installation root**.
  4. Click **BIOS** in the sidebar, then click **Save Migration** again.
- **Expected Behavior:**
  - Requirement 4 states: *"The Saves root field must not clear when the user leaves the screen."* A user-entered frontend installation root should persist across screen navigation (e.g., in `useAppStore` or project settings).
- **Actual Behavior:**
  - `frontendRoot` is initialized via local `useState(activeProject?.libraryRoots?.[0] ?? "")`. Unmounting `SavesScreen` destroys the typed value and resets it to `activeProject.libraryRoots[0]`.
  - Additionally, if a user switches `activeProject` while `SavesScreen` remains mounted, `frontendRoot` does not update, and if a project has multiple `libraryRoots`, only `libraryRoots[0]` is ever checked for saves.

---

### 6. [MEDIUM] Compatibility Data Error: `bios_rules.json` omits the standard Genesis Plus GX MD5 for `bios_CD_U.bin` and has contradictory notes/hashes for `saturn_bios.bin`

- **Location:** `src-tauri/data/bios_rules.json:101-127`, `src-tauri/data/bios_rules.json:177-188`, `src-tauri/data/emulator_matrix.json:15`
- **Steps to Reproduce & Evidence:**
  1. **Sega CD (`segacd`):**
     - `emulator_matrix.json:15` and `bios_sweep.rs:21` set `lr-genesis-plus-gx` as the default/recommended emulator for `segacd`.
     - Official Libretro documentation and `genesis_plus_gx_libretro.info` specify `bios_CD_U.bin` with MD5 **`854b9150240a198070150e4566ae1290`** (Sega CD Model 2 BIOS v2.00W), while `picodrive_libretro.info` specifies **`2efd74e3232ff260e371b99f84024f7f`** (Sega CD Model 1 BIOS v1.10).
     - `bios_rules.json:178` lists **only** `["2efd74e3232ff260e371b99f84024f7f"]` in `knownGoodMd5`. Users with the standard Libretro Genesis Plus GX `bios_CD_U.bin` (`854b9150240a198070150e4566ae1290`) get flagged with `PRESENT_HASH_MISMATCH` and `segacd` remains `Blocking`.
  2. **Sega Saturn (`saturn`):**
     - `bios_rules.json:125` states for `saturn_bios.bin`: *"Same ROM as mpr-17933.bin but must be named saturn_bios.bin and placed in bios/kronos/ for the Kronos core."*
     - However, `mpr-17933.bin` has `knownGoodMd5: ["3240872c70984b6cbfda1586cab68dbe"]` (v1.01a) while `saturn_bios.bin` has `knownGoodMd5: ["af5828fdff51384f99b3c4926be27762"]` (v1.00a). Following the instruction in `notes` by copying `mpr-17933.bin` to `bios/kronos/saturn_bios.bin` fails validation.

---

### 7. [MEDIUM] Compatibility Data Error: `format_matrix.json` marks `.zso` as `unsupported` on PPSSPP, contradicting upstream PPSSPP `BlockDevices.cpp`

- **Location:** `src-tauri/data/format_matrix.json:219-226`, `src-tauri/tests/scenarios.rs:312-316`
- **Claim in Romio:**
  - `format_matrix.json:223`: *"PPSSPP only reads the CISO header used by .cso; .zso (ZISO, LZ4) isn't recognised. Convert it to .cso or .iso with maxcso."*
- **Official Source Verification:**
  - In upstream PPSSPP (`hrydgard/ppsspp`, `Core/FileSystems/BlockDevices.cpp`), `constructBlockDevice()` and `CISOFileBlockDevice` check both `CISO_MAGIC` (`"CISO"`) and **`ZISO_MAGIC` (`"ZISO"`, `0x4F53495A`)** and decompress LZ4-compressed `.zso` blocks natively via `LZ4_decompress_safe` (supported since PPSSPP 1.14+, well before PPSSPP 1.17's CHD support cited on line 215).
  - What PPSSPP does *not* support is CISO v2 (where individual blocks mix zlib and LZ4 under the `"CISO"` magic with version `2`), whereas standard `.zso` (`"ZISO"` header generated by `maxcso --format=zso`) **is** supported by PPSSPP standalone and `lr-ppsspp`. Flagging `.zso` as `FormatIncompatible` (red error requiring re-dump/conversion) will falsely alarm users whose `.zso` games boot and play normally in PPSSPP.

---

### 8. [LOW] Visual QA, UX & `DESIGN.md` Compliance Issues

1. **Sticky `RomioCompanion` state across screens (`SavesScreen.tsx:51-55`, `BiosScreen.tsx`, `FormatScreen.tsx`, `DashboardScreen.tsx`):**
   - `SavesScreen` sets `romioState` to `"difficult_save"` (`"Save data at risk. Review this carefully before proceeding."`) when `atRisk.length > 0`.
   - Neither `BiosScreen`, `FormatScreen`, nor `DashboardScreen` (on mount) updates `romioState`. When a Curator or Rescuer visits `SavesScreen` first and then clicks `BIOS`, `Format Check`, or `Dashboard` in the sidebar, the companion remains permanently stuck on `romio_difficult_save.png` (`"Save data at risk..."`). Similarly, if `SavesScreen` has 0 roots, `romioState` stays stuck on `"pondering"` (`"Analyzing results…"`).
2. **Optional and other-region BIOS files trigger amber `"X missing"` warnings on `BiosScreen` and `DashboardScreen` (`BiosScreen.tsx:249-253`, `DashboardScreen.tsx:21-28`):**
   - Both components count `MISSING_OPTIONAL` alongside `MISSING_REQUIRED`.
   - Even if a user has a valid US PS1 BIOS (`scph5501.bin`), or even all three regional PS1 BIOSes (`scph5500.bin`, `scph5501.bin`, `scph5502.bin`), `scph1001.bin` (`MISSING_OPTIONAL`, whose note says *"use scph5501.bin unless you have a specific reason"*) prevents `allValid` from ever being true and forces an amber `"1 missing"` (or `"3 missing"`) badge on `ps1` and on the Dashboard's BIOS Validation card.
3. **Save Conflict (`conflict_detected`) cards provide no resolution affordance (`SavesScreen.tsx:289-293`):**
   - Conflict cards are now included in the red `atRisk` banner (`"Migrate, or review the conflicts, before updating"`), and the card says `"Saves found at both old and new paths. Manual review required before migrating."` However, unlike `migration_needed` cards, conflict cards hide the action button and offer no button to open the old/new folders in Explorer or create a safety checkpoint before manual merging.
4. **`DESIGN.md` Typography & Icon Drift:**
   - **Headings (`DESIGN.md:158` — *"Headings state the point ('3 BIOS files missing'), not the topic ('BIOS overview')"*):** `BiosScreen.tsx:76` (`"BIOS Validation"`), `FormatScreen.tsx:131` (`"Format Compatibility"`), `SavesScreen.tsx:74` (`"Save Migration"`), and `PreflightScreen.tsx:40` (`"Pre-flight Check"`) all use static topic headings rather than state-driven headings.
   - **Monospace paths (`DESIGN.md:156, 206` — *"Show exact data (paths, hashes, counts) in `data-mono`"*):** Library root paths in `ProjectsScreen.tsx:88-90` (`text-xs text-romio-gray`) and `DashboardScreen.tsx:74-76` (`text-sm text-romio-gray`), as well as source/destination paths inside `MigrationPlanModal` step descriptions (`SavesScreen.tsx:397`), omit `font-mono`.
   - **Unicode icon (`DESIGN.md:212` — *"Don't: Emoji as icons. Use `lucide-react`"*):** `FormatConfigBar.tsx:107` renders `"Scan ▶"` with a literal Unicode triangle instead of `<Play />` from `lucide-react` (compare `DashboardScreen.tsx:106`).

---

## Scenario & Edge-Case Matrix

| Scenario / Edge Case | How Tested | Result | Notes |
|:--|:--|:--|:--|
| **1. Curator before an update** | Rust (`curator_retrobat_library_before_an_update`, `gemini_qa.rs`) + `jsdom` (`Journey 1`) | **Partial Pass** | Starts on `SavesScreen`; Dashboard orders `["saves", "bios", "format"]`; counts `migration_needed` + `conflict_detected` in at-risk banner; `"1 file"` singular works; custom typed root is lost on leaving screen (Finding 5). |
| **2. New handheld setup** | Rust (`handheld_batocera_fresh_setup_bios`, `steam_deck_saves_under_xdg_data_home`) + `jsdom` (`Journey 2`) | **Partial Pass** | Companion switches to `tutorial`; starts on `PreflightScreen` -> `DashboardScreen` (`["bios", "format", "saves"]`); detects wrong-path `dc_boot.bin` and ES-DE/EmuDeck/RetroDECK `roms/arcade/neogeo.zip`; US Saturn blocked by Kronos rule (Finding 1). |
| **3. Rescuer after breakage** | Rust (`rescuer_finds_bad_dump_renamed_bios_and_split_saves`, `gemini_qa.rs`) + `jsdom` (`Journey 3`) | **Partial Pass** | Starts on `DashboardScreen` (`["bios", "saves", "format"]`); detects renamed BIOS by MD5 (`renameFrom`), bad dump label, and Citra/Azahar save conflicts; single-rule bad dumps fail to set `blocking: true` and show `"0 missing"` / `"All valid"` (Finding 2). |
| **Empty libraries** | Rust (`qa_empty_library_across_engines`) + `jsdom` (`Journey 2`) | **Pass** | Empty `roms/` returns 0 artifacts and renders `"No game files found in <path>"` on `FormatScreen`; empty saves renders `"No save roots found at risk"`; empty `bios/` returns 12 systems (9 blocking, 3 optional-only). |
| **Unreadable paths** | Rust (`locked_save_roots_are_reported_unreadable_not_missing`, `qa_unreadable_and_missing_paths_in_scanner_and_bios_sweep`) + `jsdom` | **Partial / Fail** | `SavesScreen` (`unreadable` banner) and `FormatScreen` (`scanError` banner for unreadable system folders) handle locked folders safely, **but** `scan_roots` (Dashboard scan) and `scan_bios_directory` (BIOS sweep) silently swallow read errors (Finding 4). |
| **Missing or incorrect BIOS** | Rust (`bios_validator::tests`, `scenarios.rs`, `gemini_qa.rs`) + `jsdom` | **Partial / Fail** | Missing required BIOS blocks; wrong filename with valid MD5 suggests rename; bad dump shows label; **but** duplicate/backup files collide in `HashMap<MD5, PathBuf>` (Finding 3) and bad dumps without missing files do not set `blocking: true` (Finding 2). |
| **Unsupported / deprecated formats** | Rust (`scenarios.rs`) + `jsdom` (`Journey 2`) | **Partial Pass** | `.rvz` on `lr-dolphin` -> `FormatIncompatible`; `.daphne` on `hypseus` -> `FormatDeprecated` (safe rename to `.hypseus`); unruled `.z64` -> `Unknown` (`"No rules yet"`, never `"All OK"`); `.zso` on `ppsspp` is inaccurately marked `unsupported` in `format_matrix.json` (Finding 7). |
| **Save conflicts** | Rust (`save_registry::tests`, `scenarios.rs`) + `jsdom` (`Journey 1 & 3`) | **Pass (with UX gap)** | Old + new paths produce `conflict_detected`, deduplicating shared destinations (Citra/Lime3DS -> Azahar, Xenia/Canary) with source rule winning; counted in `atRisk` banner; no checkpoint/open-folder action on conflict card (Finding 8.3). |

---

## Emulator & Frontend Compatibility Verification

| Claim in Romio (`src-tauri/data/*.json`) | Verification Verdict | Official Sources, Versions & Conditions |
|:--|:--|:--|
| **PS1 (`ps1`):** `scph5500.bin` (`8dd7d5296a650fac7319bce665a6a53c`, JP), `scph5501.bin` (`490f666e1afb15b7362b406ed1cea246`, US), `scph5502.bin` (`32736f17079d0b2b7024407c39bd3050`, EU), `scph1001.bin` (`924e392ed05558ffdb115408c263dccf`, US) (`bios_rules.json:1-57`) | **Verified (Hashes & Regional Rule Accurate)** | Matches Libretro `mednafen_psx_libretro.info` / `swanstation_libretro.info` and DuckStation documentation. Beetle PSX requires the region-matching BIOS filename (`scph5500.bin` / `scph5501.bin` / `scph5502.bin`) in `system/`; DuckStation can boot games with one region's BIOS if region/fast-boot patching is enabled, but requires the matching region BIOS for strict regional boot. Sources: [Libretro Beetle PSX Docs](https://docs.libretro.com/library/beetle_psx/), [DuckStation Wiki](https://github.com/stenzek/duckstation). |
| **Sega Saturn (`saturn`):** `sega_101.bin` (`85ec9ca47d8f6807718151cbcca8b964`, JP), `mpr-17933.bin` (`3240872c70984b6cbfda1586cab68dbe`, US/EU), `saturn_bios.bin` (`af5828fdff51384f99b3c4926be27762`, Kronos), `mpr-18811-mx.ic1` (`255113ba943c92a54facd25a10fd780c`, KoF '95) (`bios_rules.json:87-141`) | **Hashes Verified; Note & Grouping Inaccurate** | Hashes match Libretro `mednafen_saturn_libretro.info` and `kronos_libretro.info`. However: (1) `mpr-17933.bin` (`3240872c...`, US v1.01a) and `saturn_bios.bin` (`af5828fd...`, US v1.00a) are **different ROM revisions**, contradicting `bios_rules.json:125` (*"Same ROM as mpr-17933.bin"*); (2) `saturn_bios.bin` is only required by `lr-kronos` (`system/kronos/saturn_bios.bin`), not `lr-beetle-saturn` or `ymir` (Finding 1 & Finding 6). Sources: [Libretro Beetle Saturn Docs](https://docs.libretro.com/library/beetle_saturn/), [Libretro Kronos Docs](https://docs.libretro.com/library/kronos/). |
| **Sega CD (`segacd`):** `bios_CD_U.bin` (`2efd74e3232ff260e371b99f84024f7f`), `bios_CD_E.bin` (`e66fa1dc5820d254611fdcdba0662372`), `bios_CD_J.bin` (`278a9397d192149e84e820ac621a8edd`) (`bios_rules.json:177-217`) | **Missing Primary Genesis Plus GX US Hash** | `e66fa1dc5820d254611fdcdba0662372` (EU) and `278a9397d192149e84e820ac621a8edd` (JP) match both `genesis_plus_gx_libretro.info` and `picodrive_libretro.info`. However, for `bios_CD_U.bin` (US), `genesis_plus_gx_libretro.info` specifies **`854b9150240a198070150e4566ae1290`** (Model 2 v2.00W), whereas `2efd74e3232ff260e371b99f84024f7f` (Model 1 v1.10) is from PicoDrive/RetroPie docs. Both valid US hashes should be in `knownGoodMd5` (Finding 6). Sources: [Libretro Genesis Plus GX Docs](https://docs.libretro.com/library/genesis_plus_gx/), [Libretro PicoDrive Docs](https://docs.libretro.com/library/picodrive/). |
| **Neo Geo (`neogeo.zip`) on ES-DE:** `"ES-DE ONLY: must be in roms/arcade/ folder — NOT in bios/ or bios/mame/"` (`bios_rules.json:347-363`) | **Overstated / Context-Dependent** | In ES-DE, `lr-fbneo` and `lr-mame` search RetroArch's `system/` (`BIOS/`) directory **or** the active ROM directory (`roms/neogeo/` for Neo Geo system games, or `roms/arcade/` for Arcade system games) when using split/non-merged romsets. Placing `neogeo.zip` in `roms/arcade/` does not help a user launching Neo Geo games from `roms/neogeo/` unless RetroArch `system/` also has `neogeo.zip` or `roms/neogeo/neogeo.zip` is present. Source: [ES-DE User Guide / Emulators](https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md), [Libretro FBNeo Docs](https://docs.libretro.com/library/fbneo/). |
| **PSP (`ppsspp`):** `.iso`, `.cso`, `.pbp`, `.chd` (since 1.17) supported; `.zso` unsupported (`format_matrix.json:183-226`) | **`.chd` Verified; `.zso` Claim Incorrect** | PPSSPP 1.17 added `.chd` support (DVD-mode 2048-byte sector CHDs via `chdman createdvd`). However, PPSSPP's `Core/FileSystems/BlockDevices.cpp` (`constructBlockDevice` / `CISOFileBlockDevice`) natively supports **`ZISO_MAGIC` (`"ZISO"`, `.zso` LZ4)** since PPSSPP 1.14 (Finding 7). Source: [PPSSPP `Core/FileSystems/BlockDevices.cpp`](https://github.com/hrydgard/ppsspp/blob/master/Core/FileSystems/BlockDevices.cpp). |
| **3DS (`azahar`):** Boots `.3ds`, `.cci`, `.zcci`, `.cxi`, `.zcxi`, `.3dsx`, `.z3dsx`; `.cia`/`.zcia` conditional (must be installed); saves move from `%APPDATA%/Citra/sdmc` and `%APPDATA%/Lime3DS/sdmc` to `%APPDATA%/Azahar/sdmc` and `~/.local/share/azahar-emu/sdmc` (`format_matrix.json:228-307`, `save_paths.json:84-137`) | **Verified** | Azahar (the 2025 Lime3DS + PabloMK7 Citra merge, v2120+) introduced Zstandard-compressed `.zcci`/`.zcxi`/`.z3dsx`/`.zcia`, dropped raw `.3ds` encryption support (requires decrypted dumps or real AES keys), requires `.cia` installation via `File > Install CIA`, and uses `%APPDATA%\Azahar\sdmc` on Windows and `$XDG_DATA_HOME/azahar-emu/sdmc` (`~/.local/share/azahar-emu/sdmc`) on Linux. Source: [Azahar Emulator Loader & Docs](https://azahar-emu.org/). |
| **Xbox (`xemu`) vs. Xbox 360 (`xenia` / `xenia-canary`):** `xemu` requires XISO `.iso` (`conditional`); `xenia` / `xenia-canary` load both trimmed XISO and full XGD2/XGD3 `.iso` (`supported`) (`format_matrix.json:39-64`) | **Verified** | `xemu` requires XISO partition images (`https://xemu.app/docs/disc-images/`), whereas Xenia's `disc_image_device.cc` parses both full Redump XGD2/XGD3 images and XISO images. |
| **PS3 (`rpcs3`):** Decrypted `.iso` since `0.0.40` (PR #17855), encrypted `.iso` since `0.0.41` (PR #18498); RetroBat save move `emulators/rpcs3/dev_hdd0` -> `saves/ps3/rpcs3/hdd_0` (`format_matrix.json:309-316`, `save_paths.json:2-11`) | **Verified** | Matches RPCS3 release history and RetroBat's centralized `saves/ps3/rpcs3/hdd_0` layout. |
