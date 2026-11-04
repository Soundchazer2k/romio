# Current handoff

Development documentation only. Not part of the app or its installer.
Follow [AGENTS.md](../AGENTS.md) for commands and architecture and [DESIGN.md](../DESIGN.md) for UI rules, with the corrections listed under "Outdated instructions" below.
This repository is public: don't put personal paths, saves or BIOS files in handoff files.

**Next reviewer: Codex (round 2).** Add findings under a new "Round 2" heading in [CODEX-REVIEW.md](CODEX-REVIEW.md). Gemini follows, in [GEMINI-QA.md](GEMINI-QA.md), when manually triggered. Keep round 1 as written.

## Task

Re-review PR [#29](https://github.com/Soundchazer2k/romio/pull/29) after the fixes for round 1. Round 1 reviewed `f5d07b1`; `8f5d175` is the only new commit.

## Requirements

1. A valid BIOS for one region must not leave a system blocked because other regions' files are missing. A bad dump must not count as valid.
2. The Saves at-risk banner must include conflicts (saves at both the old and new paths).
3. One file must read "1 file", not "1 files".
4. The Saves root field must not clear when the user leaves the screen, including a typed path.

Added after round 1:

5. A required BIOS that is corrupt or misplaced must not show as fine.
6. Backup copies must not hide a correctly placed BIOS.
7. A BIOS only one emulator reads must not be required for the others.
8. `neogeo.zip` must count as valid wherever FBNeo and ES-DE actually read it.

## Code under review

| | |
|:--|:--|
| Branch | `fix/saves-bios-polish` |
| Commit | `8f5d1756946c765a72eb83d520303d7d73cd4835` |
| Base (`master`) | `d9e1e2880d959c6deb2b2ff47dd2145f629ec831` |
| New since round 1 | `git diff f5d07b1 8f5d175` |
| Whole PR | `git diff d9e1e28...8f5d175` |

Changed files in `8f5d175`:

- `src-tauri/src/engine/bios_validator.rs`: blocking, multiple copies per hash, emulator applicability, accepted paths
- `src-tauri/src/models/bios.rs`, `src/types/index.ts`: new optional rule fields `alsoAcceptedPaths`, `onlyEmulators`
- `src-tauri/src/engine/bios_sweep.rs`: test fixtures for those fields
- `src-tauri/data/bios_rules.json`: Saturn, Sega CD and Neo Geo rules
- `src/lib/utils.ts`, `src/components/bios/BiosScreen.tsx`, `src/components/dashboard/DashboardScreen.tsx`: labels
- `src/stores/index.ts`, `src/components/saves/SavesScreen.tsx`: Saves root per project
- Tests: `src-tauri/tests/scenarios.rs`, `src/lib/saves.root.test.tsx` (new), `src/lib/saves.screen.test.tsx`, `src/lib/utils.test.ts`

Use a fresh working copy, because `codex/review` may already exist:

```bash
git fetch origin
git worktree add -b codex/review-2 ../romio-codex-2 origin/docs/handoffs
git -C ../romio-codex-2 merge --no-edit 8f5d1756946c765a72eb83d520303d7d73cd4835
```

## What happened to round 1's findings

| Finding | Outcome |
|:--|:--|
| Codex P2, Gemini 5: typed Saves root lost | Fixed: `saveRoots` in the store, per project, until the app closes |
| Gemini 1: US Saturn stays blocked | Fixed: `onlyEmulators` on `saturn_bios.bin` and `mpr-17933.bin` |
| Gemini 2: bad or misplaced required BIOS shows "All valid" | Fixed: blocks; other labels say "N to check" |
| Gemini 3: copies overwrite each other | Fixed: every path is kept, and one in an accepted place wins |
| Gemini table: Neo Geo location | Fixed: `alsoAcceptedPaths`; the ES-DE-only `roms/arcade` path is gone |
| Gemini 6: Sega CD hash, Saturn note | Fixed in the data. Source correction: the hash comes from libretro's `genesis_plus_gx.md`, not the core's info file. |
| Codex and Gemini: regional wording | Rows now say "Missing — needed for JP games". The product rule itself stays (limitation 1). |
| Gemini 7: PPSSPP `.zso` | **Rejected.** Upstream `Core/FileSystems/BlockDevices.cpp` and `.h` contain no `ZISO` or LZ4 handling, only `CISO`. Show current source if you disagree. |
| Gemini 5: switching project while Saves stays open | Not reachable from the sidebar or title bar. The store is keyed per project regardless, and a test covers it. |
| Gemini 4: failed scans look like empty libraries | **Deferred, separate PR, next.** Still present. |
| Gemini 8: stuck companion, optional files showing amber, conflict card actions, design drift | **Deferred, separate PRs.** Still present. |

Gemini's 9 extra tests from round 1 aren't in the repository, so they weren't re-run. The cases they found now have tests here.

## Checks performed

All at commit `8f5d175`, on Windows 11. GitHub CI on this commit hasn't finished at the time of writing.

### Automated tests

| Check | Result | What it covers |
|:--|:--|:--|
| `cargo test --workspace` | 43 unit + 15 scenario pass | Real engine and shipped rule files, against fake libraries in temp folders. `real_library_smoke` skips without `ROMIO_REAL_LIBRARY`. |
| New scenarios | Failed on `f5d07b1`, pass now | `neogeo_bios_is_valid_wherever_fbneo_looks`, `bad_or_misplaced_required_bios_blocks`, `backup_copies_do_not_hide_a_correctly_placed_bios`, `saturn_us_bios_depends_on_the_emulator`, `shipped_bios_data_has_the_documented_hashes` |
| `pnpm exec vitest run` | 52 pass | jsdom with mocked IPC. `saves.root.test.tsx` uses the real store, and failed on `f5d07b1`. `saves.screen.test.tsx` also mocks the store. |
| `tsc`, `pnpm lint`, `vite build` | Pass | Types, lint, frontend build |
| `cargo audit` (local) | No vulnerabilities, 2 known warnings | Dependency advisories |

Not run: `pnpm design:lint` (no design tokens changed).

### Mocked browser checks

| Check | Result | What it covers |
|:--|:--|:--|
| `pnpm exec playwright test tests/smoke.spec.ts` | 1 pass | The app loads in test mode with fake IPC. It doesn't exercise anything this PR changes. |

### Actual desktop-app checks

`pnpm tauri dev` with the real Rust backend, confirmed by `window.__TAURI_INTERNALS__`, and driven over the WebView2 debug port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`). The project was a fake RetroBat library of placeholder files. Save discovery also read this machine's real `%APPDATA%`, read-only.

| Check | Result |
|:--|:--|
| Type a Saves root, go to BIOS, return | Typed path kept |
| Corrupt required `mcpx_1.0.bin` | "Hash mismatch"; Xbox "Blocking" |
| Different `neogeo.zip` in the BIOS folder | "Hash mismatch"; Neo Geo row "1 to check", not blocking |
| Saturn, Beetle default, no BIOS files | `saturn_bios.bin` "Not applicable" with its explanation; US and JP "Missing — required" |
| Earlier, at `f5d07b1` and unchanged since: banner with a conflict, "1 file" | "2 save roots at risk", "1 file" |

Not checked on desktop:

- **A valid BIOS of any kind, and so the region-complete path and "Missing — needed for JP games".** It needs genuine dumps; only automated tests cover it.
- **The Dashboard BIOS badge.** The card showed "Run a scan to see validation results." Only `biosIssueLabel`'s unit test covers it.
- Plan Migration, migration execution and checkpoints, `pnpm tauri build`, the installer, Linux and macOS.

## Known limitations

1. **Romio doesn't know a library's regions.** A valid US BIOS unblocks PS1 even for a library of only Japanese games. Rows say which games still need the other file, but the system shows as not blocked. Product rule, kept deliberately; challenge it if you think it misleads.
2. **Misplaced files now block,** based on Romio's path rules. If an emulator actually reads a location those rules don't list, a working setup shows "Blocking". Only `neogeo.zip` has extra locations so far.
3. **Results saved before this fix stay until revalidated.** `biosResults` is stored per project, so old badges remain until the next scan or Revalidate BIOS.
4. **`onlyEmulators` lists are fixed.** An emulator set in `emulatorPrefs` but not listed makes both Saturn US rules not applicable, so US no longer blocks for it. Romio's matrix only offers Ymir, Beetle Saturn and Kronos.
5. **A typed Saves root lasts until the app closes,** not across restarts.
6. **The Saves root default assumes the first library root is the frontend install.** A root that is only a ROM folder finds nothing there and gives no warning. Other roots are ignored.
7. **`neogeo.zip` hash mismatches never block,** because zips can be rebuilt. A corrupt zip shows "1 to check", not "Blocking".

CI, Sourcery (budget used up) and Qodo haven't reviewed this commit.

## Review focus for Codex

- **Correctness:** the blocking expression and `accepted_paths`, `hash_inconclusive`, and how the region rule combines with `NotApplicable`. Check every system in `bios_rules.json`, not just the ones with new tests.
- **False blocks:** limitation 2. Is any shipped rule now likely to block a working setup?
- **Tests:** whether the new scenarios would catch a regression in each fix.
- **Data:** the Saturn and Neo Geo rules against the libretro docs.

## Next for Gemini

Re-test the user journeys on this commit, and in particular the BIOS wording, "to check" labels and the typed Saves root. Save journey tests you want kept outside application code, or say where they can be read.

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
