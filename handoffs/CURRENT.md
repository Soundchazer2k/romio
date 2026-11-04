# Current handoff

Development documentation only. Not part of the app or its installer.
Follow [AGENTS.md](../AGENTS.md) for commands and architecture and [DESIGN.md](../DESIGN.md) for UI rules, with the corrections listed under "Outdated instructions" below.
This repository is public: don't put personal paths, saves or BIOS files in handoff files.

**Next reviewer: Gemini (Antigravity).** Add findings under a new "Round 3" heading in [GEMINI-QA.md](GEMINI-QA.md). Keep earlier rounds as written. Codex's rounds 1 and 2 are in [CODEX-REVIEW.md](CODEX-REVIEW.md).

## Task

QA the updated UI for PR [#29](https://github.com/Soundchazer2k/romio/pull/29) at commit `76201d1`, after the fixes for Codex's round 2.

## What to test

1. **Saves root:** typing a path, clearing it, leaving and returning, and separate values per project.
2. **Regional BIOS wording:** "Missing — needed for JP games" and "Missing — optional". Does a non-blocked system suggest more readiness than it should?
3. **BIOS verdicts:** "Blocking", "Wrong path", "Hash mismatch", "Not applicable" and "N to check", on the BIOS screen.
4. **Badge consistency:** the Dashboard BIOS badge against the BIOS screen for the same project. It was never seen on desktop, because the card asked for a scan first; run a scan.
5. **Saves banner:** conflicts counted, and "1 file".

Test in the real desktop app if your environment allows it. In round 1, port binding was blocked in your sandbox; if that still happens, say so and separate what you verified in `jsdom` from what you didn't see. Native emulator checks of the Kronos and PCSX2 cases are welcome only if you have your own dumps and emulators; otherwise report them as not covered. Don't commit dumps or screenshots with private paths.

Cite the exact source line for any compatibility claim, and mark anything you couldn't confirm as unverified. Keep any journey tests you want preserved outside application code, and say where they can be read.

## Requirements

1. A valid BIOS for one region must not leave a system blocked because other regions' files are missing. A bad dump must not count as valid.
2. The Saves at-risk banner must include conflicts (saves at both the old and new paths).
3. One file must read "1 file", not "1 files".
4. The Saves root field must not clear when the user leaves the screen, including a typed path.
5. A required BIOS that is corrupt or misplaced must not show as fine.
6. Backup copies must not hide a correctly placed BIOS.
7. A BIOS only one emulator reads must not be required for the others.
8. `neogeo.zip` must count as valid wherever FBNeo and ES-DE actually read it.
9. A working setup must not block because of a filename the emulator doesn't care about, or a fallback location it does read.

## Code under review

| | |
|:--|:--|
| Branch | `fix/saves-bios-polish` |
| Commit | `76201d1eddc7af73cef172cdca71908ae6e7140d` |
| Base (`master`) | `d9e1e2880d959c6deb2b2ff47dd2145f629ec831` |
| New since Codex round 2 | `git diff 8f5d175 76201d1` |
| Whole PR | `git diff d9e1e28...76201d1` |

Use a fresh working copy, because earlier review branches may already exist:

```bash
git fetch origin
git worktree add -b gemini/qa-3 ../romio-gemini-3 origin/docs/handoffs
git -C ../romio-gemini-3 merge --no-edit 76201d1eddc7af73cef172cdca71908ae6e7140d
```

## What happened to the review findings

| Finding | Outcome |
|:--|:--|
| Codex round 1 P2, Gemini 5: typed Saves root lost | Fixed in `8f5d175`; Codex round 2 confirmed it |
| Gemini 1: US Saturn stays blocked | Fixed in `8f5d175`: `onlyEmulators` |
| Gemini 2: bad or misplaced required BIOS shows "All valid" | Fixed in `8f5d175`: blocks; other labels say "N to check" |
| Gemini 3: copies overwrite each other | Fixed in `8f5d175`: every path is kept, and one in an accepted place wins |
| Gemini table: Neo Geo location | Fixed in `8f5d175`: `alsoAcceptedPaths` |
| Gemini 6: Sega CD hash, Saturn note | Fixed in `8f5d175` and `76201d1` |
| Codex round 2: Kronos fallbacks | Fixed in `76201d1`. Confirmed in `retro_load_game`: `kronos/saturn_bios.bin`, then `saturn_bios.bin`, `sega_101.bin`, `mpr-17933.bin`. The docs say any valid Saturn BIOS works, so the rule lists the Saturn revisions in libretro's `System.dat`. |
| Codex round 2: PCSX2 filename | Fixed in `76201d1`: `anyNameEmulators`. Confirmed in PCSX2's `BiosTools.cpp`, which isn't recursive. The same behaviour applies to DuckStation (`bios.cpp`), so its PS1 rules got it too, and to Ymir, per its README. |
| Codex round 2: zip location | Fixed in `76201d1`: an unknown hash is only a warning where the core reads the file |
| Gemini 7: PPSSPP `.zso` | **Rejected.** Upstream `Core/FileSystems/BlockDevices.cpp` and `.h` contain no `ZISO` or LZ4 handling, only `CISO`. Show current source if you disagree. |
| Gemini 4: failed scans look like empty libraries | **Deferred, separate PR, next.** Still present. |
| Gemini 8: stuck companion, optional files showing amber, conflict card actions, design drift | **Deferred, separate PRs.** Still present; no need to re-report. |

## Checks performed

All at commit `76201d1`, on Windows 11. GitHub CI on this commit hadn't finished at the time of writing.

### Automated tests

| Check | Result | What it covers |
|:--|:--|:--|
| `cargo test --workspace` | 43 unit + 18 scenario pass | Real engine and shipped rule files, against fake libraries in temp folders. `real_library_smoke` skips without `ROMIO_REAL_LIBRARY`. |
| New in this commit | Failed on `8f5d175`, pass now | `kronos_reads_its_fallback_files`, `emulators_that_read_contents_accept_any_filename`, `neogeo_zip_location_matters_whatever_its_hash`, and new assertions in `shipped_bios_data_has_the_documented_hashes` |
| `pnpm exec vitest run` | 52 pass | jsdom with mocked IPC. `saves.root.test.tsx` uses the real store. |
| `tsc`, `pnpm lint`, `vite build` | Pass | Types, lint, frontend build |
| `cargo audit` (local) | No vulnerabilities, 2 known warnings | Dependency advisories |

Kronos and PCSX2 cases use fixture hashes and placeholder bytes, not real BIOS files.

### Mocked browser checks

| Check | Result | What it covers |
|:--|:--|:--|
| `pnpm exec playwright test tests/smoke.spec.ts` | 1 pass | The app loads in test mode with fake IPC. It doesn't exercise anything this PR changes. |

### Actual desktop-app checks

`pnpm tauri dev` with the real Rust backend, confirmed by `window.__TAURI_INTERNALS__`, and driven over the WebView2 debug port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`). The project was a fake RetroBat library of placeholder files. Save discovery also read this machine's real `%APPDATA%`, read-only.

| Check | Commit | Result |
|:--|:--|:--|
| New rule fields through real IPC (`get_bios_rules`) | `76201d1` | `onlyEmulators`, `anyNameEmulators`, `alsoAcceptedPaths` all arrive |
| Unrecognised `neogeo.zip` in `bios/misc/` | `76201d1` | "Wrong path"; Neo Geo "Blocking" |
| Unrecognised `my-ps2.bin` in the BIOS folder | `76201d1` | PS2 "Missing — required", "Blocking": unknown bytes aren't accepted as a BIOS |
| Typed Saves root kept after leaving | `8f5d175` | Kept |
| Corrupt `mcpx_1.0.bin` | `8f5d175` | "Hash mismatch"; Xbox "Blocking" |
| Different `neogeo.zip` in the BIOS folder | `8f5d175` | "Hash mismatch"; Neo Geo "1 to check", not blocking |
| Saturn, Beetle default, no BIOS files | `8f5d175` | `saturn_bios.bin` "Not applicable" with its explanation |
| Banner with a conflict, "1 file" | `f5d07b1` | "2 save roots at risk", "1 file" |

Not checked on desktop:

- **A valid BIOS of any kind:** the region-complete path, "Missing — needed for JP games", and the Kronos and any-filename paths. They need genuine dumps; only automated tests cover them.
- **The Dashboard BIOS badge.** Only `biosIssueLabel`'s unit test covers it.
- Plan Migration, migration execution and checkpoints, `pnpm tauri build`, the installer, Linux and macOS.

## Known limitations

1. **Romio doesn't know a library's regions.** A valid US BIOS unblocks PS1 even for a library of only Japanese games. Rows say which games still need the other file, but the system shows as not blocked. Product rule, kept deliberately.
2. **Misplaced files block, based on Romio's path rules.** Emulators not yet checked at source could still be flagged wrongly. In particular, xemu takes its MCPX path from a setting, so an MCPX elsewhere may work while Romio shows "Wrong path".
3. **Only listed BIOS revisions are recognised.** PS2's required rule is one specific US file, so another real PS2 BIOS shows as missing and blocks, even though PCSX2 would use it. A valid Saturn BIOS absent from `System.dat` blocks under Kronos.
4. **`neogeo.zip` beside the ROMs:** Romio can't tell which folder a game is in, so any of the listed ROM folders counts.
5. **Results saved before this fix stay until revalidated.** `biosResults` is stored per project.
6. **`onlyEmulators` lists are fixed.** An emulator set in `emulatorPrefs` but not listed gets "Not applicable" for those Saturn rules. Romio's matrix only offers Ymir, Beetle Saturn and Kronos.
7. **A typed Saves root lasts until the app closes,** not across restarts.
8. **The Saves root default assumes the first library root is the frontend install.** A root that is only a ROM folder finds nothing there and gives no warning. Other roots are ignored.
9. **A corrupt `neogeo.zip` in a readable place shows "1 to check",** not "Blocking", because a rebuilt zip's hash changes too.

Sourcery's budget is used up, and Qodo hasn't reviewed this commit.

## After Gemini

Bring both reports back to Claude. Codex hasn't reviewed `76201d1`; decide after Gemini whether a third Codex pass is worthwhile.

## Outdated instructions

Flagged, not changed:

| Where | Says | Actual |
|:--|:--|:--|
| `AGENTS.md`, Screens & Status | `format` is a placeholder | Implemented (`CLAUDE.md` is correct). The other unfinished screens are hidden from the sidebar. |
| `AGENTS.md` | No design section, no `cargo test --test scenarios` | `CLAUDE.md` has both |
| `AGENTS.md`, `CLAUDE.md`, Type Sync | `SaveCheckpoint` missing from TS types | Defined in `src/types/index.ts` |
| `AGENTS.md`, `CLAUDE.md`, Commands | `pnpm test` | Starts Vitest in watch mode and doesn't exit; use `pnpm exec vitest run` to run once |
| `README.md:87-88` | Links to `docs/contributing/overview.md` and `frontend-adapter.md` | Neither file exists, and the adapters were removed in #20 |

## Repository state to leave alone

- `.claude/settings.local.json` has local edits; never commit it.
- `.codex/` and `.agents/skills/tauri-contract-sync/` are untracked and not from this work.
- Dependabot PRs #25 to #28 are open and aren't part of this review. #25 is superseded by #24.
