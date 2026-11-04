# Current handoff

Development documentation only. Not part of the app or its installer.
Follow [AGENTS.md](../AGENTS.md) for commands and architecture and [DESIGN.md](../DESIGN.md) for UI rules, with the corrections listed under "Outdated instructions" below.
This repository is public: don't put personal paths, saves or BIOS files in handoff files.

**Next reviewer: Codex.** Write findings in [CODEX-REVIEW.md](CODEX-REVIEW.md). Gemini follows, in [GEMINI-QA.md](GEMINI-QA.md), when manually triggered.

## Task

Review PR [#29](https://github.com/Soundchazer2k/romio/pull/29): four issues found by running the real app against a fake RetroBat library.

## Requirements

1. A valid BIOS for one region must not leave a system blocked because other regions' files are missing. A bad dump must not count as valid.
2. The Saves at-risk banner must include conflicts (saves at both the old and new paths).
3. One file must read "1 file", not "1 files".
4. The Saves root field must not clear when the user leaves the screen.

## Code under review

| | |
|:--|:--|
| Branch | `fix/saves-bios-polish` |
| Commit | `f5d07b13e4802ac80ed53e5ec427be36891d10d6` |
| Base (`master`) | `d9e1e2880d959c6deb2b2ff47dd2145f629ec831` |
| Diff | `git diff d9e1e28...f5d07b1` |

Changed files:

- `src-tauri/src/engine/bios_validator.rs`: regional rule and unit test
- `src/components/saves/SavesScreen.tsx`: banner, plural, starting root
- `src/lib/saves.screen.test.tsx`: screen test

Use your own working copy. This one has both the handoff files and the code under review:

```bash
git fetch origin
git worktree add -b codex/review ../romio-codex origin/docs/handoffs
git -C ../romio-codex merge --no-edit f5d07b13e4802ac80ed53e5ec427be36891d10d6
```

## Checks performed

All at commit `f5d07b1`, on Windows 11.

### Automated tests

| Check | Result | What it covers |
|:--|:--|:--|
| `cargo test --workspace` | 43 unit + 11 scenario pass | Real engine and shipped rule files, against fake libraries in temp folders. Includes new `one_complete_region_is_enough_to_play`. `real_library_smoke` skips without `ROMIO_REAL_LIBRARY`. |
| `pnpm exec vitest run` | 46 pass | jsdom, with the stores and IPC mocked. Includes new `starts at the project's library root and counts conflicts as at risk`, which fails on the old `SavesScreen.tsx`. |
| `tsc`, `pnpm lint`, `vite build` | Pass | Types, lint, frontend build |
| `cargo audit` (local) | No vulnerabilities, 2 known warnings | The CI audit workflow didn't run on this PR, because it only runs when dependencies change |
| GitHub CI on this commit | `check` and CodeQL (actions, javascript-typescript, rust) pass | Same tests on `windows-latest`, plus static analysis |

Not run: `pnpm design:lint` (no design tokens changed).

### Mocked browser checks

| Check | Result | What it covers |
|:--|:--|:--|
| `pnpm exec playwright test tests/smoke.spec.ts` | 1 pass | The app loads in test mode with fake IPC. It doesn't exercise anything this PR changes. |

### Actual desktop-app checks

`pnpm tauri dev` with the real Rust backend, confirmed by `window.__TAURI_INTERNALS__`. The page was driven over the WebView2 debug port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`). The project was a fake RetroBat library made of placeholder files, created earlier with the native folder picker. Save discovery also read this machine's real `%APPDATA%`, read-only.

| Check | Result |
|:--|:--|
| Open project, Saves root field | Pre-filled with the project's library root |
| At-risk banner, one migration needed plus one real yuzu/Eden conflict | "2 save roots at risk", with the new wording |
| Save root with one file | "1 file" |
| Leave Saves for BIOS and return | Root still there |
| Type another path, leave and return | **Back to the project root; the typed path is lost** |
| PS1 with a fake `scph5501.bin` (Revalidate BIOS) | "Hash mismatch"; JP and EU "Missing — required"; system "Blocking" |

Not checked on desktop: the valid-region path. It needs a genuine BIOS dump, so only the unit test covers it. Also not exercised: Plan Migration, migration execution, checkpoints (not changed by this PR), `pnpm tauri build`, the installer, Linux and macOS.

## Known limitations

1. **Romio doesn't know a library's regions.** A valid US BIOS unblocks PS1 even for a library of only Japanese games, though that system's games need the JP file. That row shows "Missing — optional" while its note still says "Required for JP-exclusive titles".
2. **A hand-typed Saves root is lost on leaving the screen** (table above). Requirement 4 is only met for the default root.
3. **The Saves root default assumes the first library root is the frontend install.** A root that is only a ROM folder finds nothing there and gives no warning. Other roots are ignored.
4. **Save discovery now also searches the library root when the screen opens.** It already ran on open, but only covered `%APPDATA%` until someone typed a path.
5. **The companion changes for conflicts.** Conflicts now count in `atRisk`, so a lone conflict sets `difficult_save` where it used to set `concerned`. Not checked visually.
6. **A hash mismatch in one region doesn't block on its own** if another region is complete or nothing is missing. Only `MissingRequired` blocks. This predates the PR.

No independent review yet: Sourcery skipped this PR (review budget used up) and Qodo hasn't commented.

## Review focus for Codex

- **Correctness:** the region grouping in `validate_system_bios`, including Saturn, whose US region has two required files, and rules with no region.
- **Save safety:** whether counting conflicts, or discovering on open, can lead anyone towards a migration that overwrites saves.
- **Error handling:** an unreadable or missing default root.
- **Tests:** gaps in the two new tests, including the limitations above.

## Outdated instructions

Flagged, not changed:

| Where | Says | Actual |
|:--|:--|:--|
| `AGENTS.md`, Screens & Status | `format` is a placeholder | Implemented (`CLAUDE.md` is correct). The other unfinished screens are hidden from the sidebar. |
| `AGENTS.md` | No design section, no `cargo test --test scenarios` | `CLAUDE.md` has both |
| `AGENTS.md`, `CLAUDE.md`, Type Sync | `SaveCheckpoint` missing from TS types | Defined at `src/types/index.ts:195` |
| `AGENTS.md`, `CLAUDE.md`, Commands | `pnpm test` | Starts Vitest in watch mode and doesn't exit; use `pnpm exec vitest run` to run once |
| `README.md:86-88` | Links to `docs/contributing/overview.md` and `frontend-adapter.md` | Neither file exists, and the adapters were removed in #20 |

## Repository state to leave alone

- `.claude/settings.local.json` has local edits; never commit it.
- `.codex/` and `.agents/skills/tauri-contract-sync/` are untracked and not from this work.
- Dependabot PRs #25 to #28 are open and aren't part of this review. #25 is superseded by #24.
