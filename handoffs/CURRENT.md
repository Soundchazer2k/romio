# Current handoff

Development documentation only. Not part of the app or its installer.
Follow [AGENTS.md](../AGENTS.md) for commands and architecture and [DESIGN.md](../DESIGN.md) for UI rules, with the corrections listed under "Outdated instructions" below.
This repository is public: don't put personal paths, saves or BIOS files in handoff files.

**Next: the user's merge decision.** No reviewer is assigned. If Codex is asked to confirm the last commit, add findings under a new "Round 5" heading in [CODEX-REVIEW.md](CODEX-REVIEW.md). Keep earlier rounds as written. Gemini's rounds are in [GEMINI-QA.md](GEMINI-QA.md).

## Task

PR [#29](https://github.com/Soundchazer2k/romio/pull/29) at commit `8b2e737`, after fixing Codex's two round 4 blockers. Nothing has reviewed `8b2e737` independently.

## Focus if Codex confirms the last commit

Narrow: `git diff 4de9694 8b2e737`.

- Do R4-1 and R4-2 hold, and do the new tests prove it?
- `same_path`: anything it should cover but doesn't, or breaks on a case-sensitive filesystem?
- The Beetle PSX name lists in `bios_rules.json` against `libretro.c:768-820`.

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
| Commit | `8b2e737884f7b4987377006bd3bb44f8d52c5579` |
| Base (`master`) | `d9e1e2880d959c6deb2b2ff47dd2145f629ec831` |
| New since Codex round 4 | `git diff 4de9694 8b2e737` |
| Whole PR | `git diff d9e1e28...8b2e737` |

Use a fresh working copy, because earlier review branches may already exist:

```bash
git fetch origin
git worktree add -b codex/review-5 ../romio-codex-5 origin/docs/handoffs
git -C ../romio-codex-5 merge --no-edit 8b2e737884f7b4987377006bd3bb44f8d52c5579
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
| Codex round 3, R3-1: Kronos fallback hides a corrupt preferred file | Fixed in `4de9694`: `firstExistingEmulators`. Kronos takes the first file that exists without checking it (`libretro.c:1619-1638`). |
| Codex round 3, R3-2: Beetle PSX renamed BIOS rejected | Fixed in `4de9694`. Named files first, then a checksum search of the top folder (`libretro.c:633`, `:660-667`, `:843-845`). My test had enforced the wrong behaviour; corrected. Beetle Saturn does open exact names (`ss.c:1846-1849`). |
| Codex round 4, R4-1: corrupt named alias bypasses first-existing | Fixed in `8b2e737`: Beetle PSX's named lists are in `alsoAcceptedPaths`, in its order. |
| Codex round 4, R4-2: valid uppercase name called corrupt on Windows | Fixed in `8b2e737`: `same_path` compares under the host filesystem's case rules, everywhere Romio decides a file is in place. |
| Gemini 7: PPSSPP `.zso` | **Rejected, and Gemini retracted it in round 3.** Upstream `Core/FileSystems/BlockDevices.cpp` and `.h` contain no `ZISO` or LZ4 handling, only `CISO`. |
| Gemini round 3 | PASS on all nine requirements, in `jsdom` only: its sandbox still blocks the desktop app. No blocking bugs. Its tests are in a private scratch folder, so they weren't re-run. Some citations were wrong (Sega CD's source, `yabause/kronos`), and the Beetle Saturn source claim wasn't confirmed. |
| Gemini round 3 notes | **Deferred.** "1 systems incomplete"; hash-mismatch rows and an unrecognised zip flagged Wrong path don't show the file's path. |
| Gemini 4: failed scans look like empty libraries | **Deferred, separate PR, next.** Still present. |
| Gemini 8: stuck companion, optional files showing amber, conflict card actions, design drift | **Deferred, separate PRs.** Still present; no need to re-report. |
| Found by Claude on desktop: Dashboard summary row says "0 Blocking" above a "9 blocking" BIOS card | **Deferred, separate PR.** The summary comes from scan results, not the BIOS check. Not traced further; appears to predate #29. |

## Checks performed

Automated and mocked checks are at commit `8b2e737`, on Windows 11. GitHub CI on this commit hadn't finished at the time of writing.

### Automated tests

| Check | Result | What it covers |
|:--|:--|:--|
| `cargo test --workspace` | 43 unit + 19 scenario pass | Real engine and shipped rule files, against fake libraries in temp folders. `real_library_smoke` skips without `ROMIO_REAL_LIBRARY`. |
| New in `8b2e737` | Failed on `4de9694`, pass now | New cases in `emulators_that_read_contents_accept_any_filename`, and `filename_case_does_not_matter_on_windows` (Windows only) |
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
| Real scan, then the Dashboard BIOS card against the BIOS screen | `76201d1` | "9 blocking" on the card; the same 9 systems on the BIOS screen |
| New rule fields through real IPC (`get_bios_rules`) | `76201d1` | `onlyEmulators`, `anyNameEmulators`, `alsoAcceptedPaths` all arrive |
| Unrecognised `neogeo.zip` in `bios/misc/` | `76201d1` | "Wrong path"; Neo Geo "Blocking" |
| Unrecognised `my-ps2.bin` in the BIOS folder | `76201d1` | PS2 "Missing — required", "Blocking": unknown bytes aren't accepted as a BIOS |
| Typed Saves root kept after leaving | `8f5d175` | Kept |
| Corrupt `mcpx_1.0.bin` | `8f5d175` | "Hash mismatch"; Xbox "Blocking" |
| Different `neogeo.zip` in the BIOS folder | `8f5d175` | "Hash mismatch"; Neo Geo "1 to check", not blocking |
| Saturn, Beetle default, no BIOS files | `8f5d175` | `saturn_bios.bin` "Not applicable" with its explanation |
| Banner with a conflict, "1 file" | `f5d07b1` | "2 save roots at risk", "1 file" |

The desktop checks above weren't re-run at `4de9694` or `8b2e737`, which only change engine logic and rule data. Automated tests cover them.

Not checked on desktop:

- **A valid BIOS of any kind:** the region-complete path, "Missing — needed for JP games", and the Kronos and any-filename paths. They need genuine dumps; only automated tests cover them.
- **The Dashboard's "N to check" and "All valid" badges.** Only "N blocking" was seen on desktop; `biosIssueLabel`'s unit test covers the rest.
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
10. **Accepted names aren't per emulator.** Beetle PSX's names, like `scph7003.bin`, count as in place for any PS1 emulator holding those bytes. DuckStation accepts any name anyway; others in `emulatorPrefs` could be wrong.
11. **Case rules follow the platform default.** Windows and macOS compare without case, Linux with it. A case-sensitive macOS volume would be judged wrongly. The Windows case test only runs on Windows; Linux and macOS weren't run.

Sourcery's budget is used up, and Qodo hasn't reviewed this commit.

## After this

Visual QA in the real app is still outstanding. Gemini can't do it from its sandbox, so someone needs to look at the running app.

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
