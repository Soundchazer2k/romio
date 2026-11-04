# Codex review

Independent review of PR #29, performed 2026-11-04.

Reviewed commit: `f5d07b13e4802ac80ed53e5ec427be36891d10d6`, against `d9e1e2880d959c6deb2b2ff47dd2145f629ec831`. Fetched origin and confirmed the PR branch still points at this commit and the remote handoff matches the local brief.

**Recommendation: changes requested. One confirmed requirement remains unmet.**

## Finding

### [P2] Preserve the edited frontend root across screen navigation

Location: `src/components/saves/SavesScreen.tsx:20-21` at the reviewed commit.

`useState(activeProject?.libraryRoots?.[0] ?? "")` supplies an initial value; it does not retain a user's edits when SavesScreen unmounts. `App.tsx` switches the rendered component through `SCREENS[screen]`, so leaving Saves and returning creates fresh local state. Discovery silently returns to the project's first library root instead of the frontend installation the user selected. This can hide frontend-relative save roots and does not satisfy requirement 4.

Independent reproduction in an isolated snapshot of the exact commit:

1. Render SavesScreen for a project whose first library root is `/frontend-default`.
2. Change the frontend root input to `/frontend-edited`.
3. Unmount, then render SavesScreen again with the same project.
4. Expect `/frontend-edited`; actual value is `/frontend-default`.

The added review-only test failed on that exact assertion. The existing new test checks only initial population and never leaves the screen, so it cannot catch this failure.

Suggested fix: retain the selected frontend root outside this screen's local state, scoped to the project. Use the first library root only as the initial fallback. Add a navigation/remount regression test and verify project switching cannot reuse another project's edited path. Persistence across application restarts is not required by this handoff.

## Other review results

- Conflict roots now contribute to the risk banner. They still cannot open a migration plan: `canPlan` requires `migration_needed`, and the conflict card offers only a manual-review warning. Execution remains unavailable. No new overwrite path identified in this diff.
- Both changed file-count displays correctly distinguish one file from other counts.
- The regional grouping requires every required entry in a candidate region to be `PresentValid`. A missing required rule without a region still blocks. Hash-mismatched and wrong-path entries cannot complete a region. The candidate-region enumeration also prevents an empty required group from vacuously completing a region.
- The claim that one region is sufficient is a product assumption, not verification of every game or emulator. Missing regional files are relabeled optional even though the library's game regions are unknown. This is already disclosed in CURRENT.md; Gemini should check that the resulting UI does not suggest universal readiness.
- Automatically using the first library root assumes it is a frontend installation root. Projects can instead contain ROM-only roots. This known limitation is especially relevant when the edited override is subsequently lost.
- Save-discovery query errors and migration-plan promise rejections are not surfaced explicitly by this screen. Those paths predate this diff; they are follow-up work rather than new PR findings.

## Verification and limits

- Used a disposable source snapshot, not a branch switch or changes to Claude's application files. The handoff's suggested sibling worktree was replaced with an in-workspace snapshot to stay inside the authorized writable workspace.
- Ran the complete frontend test suite against the snapshot: **46 existing tests passed; one added independent remount test failed**. The focused SavesScreen run similarly produced five existing passes and the same one failure.
- The review-only test was disposable and has not been added to application code. Its reproduction is recorded above for Claude to turn into the permanent regression test.
- Inspected the changed Rust logic and its sweep/command callers, shipped regional rule grouping, application screen switching, save planning guards, and the bundle resource configuration (`data/*`; frontend output `dist`). Handoff Markdown is not referenced by either bundle input in the inspected configuration.
- Did not rerun Rust tests, lint, production build, native desktop workflows, or an installer. CURRENT.md's results for those checks remain Claude's evidence, not independent verification.
- Application code, real libraries, saves, BIOS files, and local agent settings were not changed. No commit, push, or GitHub review was posted.

## Next handoff

Claude: fix the project-scoped frontend-root retention and add the regression test, then update CURRENT.md with the new commit and checks. Gemini: test the navigation behavior on that updated commit and inspect regional BIOS/conflict messaging. Manually trigger each handoff; this report does not start another agent.

## Round 2

Reviewed 2026-11-04: PR commit `8f5d1756946c765a72eb83d520303d7d73cd4835`, especially the changes since `f5d07b1`. Fetched origin, read `origin/docs/handoffs:handoffs/CURRENT.md`, and followed its worktree commands: isolated branch `codex/review-2`, based on `origin/docs/handoffs`, merged with the reviewed commit. Round 1 above is unchanged.

**Recommendation: changes requested. Round 1's path-retention finding is fixed; three BIOS verdict issues remain.**

### [P2] Recognize Kronos's actual fallback files and accepted revisions

Locations at the reviewed commit: `src-tauri/data/bios_rules.json:111-127`; `src-tauri/src/engine/bios_validator.rs:137-156`.

The new `onlyEmulators` excludes `mpr-17933.bin` from Kronos, while `saturn_bios.bin` is required at `kronos/` and JP `sega_101.bin` is also expected under `kronos/`. With only a valid `bios/mpr-17933.bin`, Romio now marks Saturn blocking for `lr-kronos`. Kronos actually falls back from `kronos/saturn_bios.bin` to root-level `saturn_bios.bin`, `sega_101.bin`, then `mpr-17933.bin`. Libretro also explicitly says the listed Saturn hash is a hint and other valid Saturn revisions work. The new note saying a renamed mpr revision fails validation describes Romio's restriction rather than the emulator's requirement.

Independent engine reproduction: create `lib.bios("bios/mpr-17933.bin", "mpr-17933.bin")`, run the shipped fixture rules with Saturn preference `lr-kronos`, and assert Saturn is not blocking. **Fails: Saturn is blocking.** Existing scenarios cover only the preferred Kronos location/hash, so they miss the working fallback setup.

Correction: model the accepted Kronos paths, filenames and known valid alternative BIOS revisions as alternatives, without making all alternatives independently mandatory. Add coverage for a root-level fallback and a supported alternate revision at the preferred filename.

Primary evidence: [Kronos libretro loader, retro_load_game](https://github.com/FCare/Kronos/blob/extui-align/yabause/src/libretro/libretro.c#L1513-L1531), [Libretro Kronos BIOS documentation](https://docs.libretro.com/library/kronos/#bios).

### [P2] Do not treat a PCSX2-supported filename as a blocking wrong path

Locations: `src-tauri/src/engine/bios_validator.rs:76-86,156-178`; PS2 required rule in `src-tauri/data/bios_rules.json`.

The new blocking expression makes a previously advisory filename mismatch fatal. Place the known-good bytes for `SCPH-70012_BIOS_V12_USA_200.bin` directly in the configured BIOS directory as `my-ps2.bin`, selected in PCSX2. Romio finds the hash but demands the exact shipped filename, assigns `PresentWrongPath`, and blocks PS2. PCSX2 enumerates every file in the configured BIOS directory and identifies BIOS images by contents; it does not require that particular filename.

Independent engine reproduction: `lib.bios("bios/my-ps2.bin", "SCPH-70012_BIOS_V12_USA_200.bin")`, default PS2 sweep, assert PS2 is not blocking. **Fails: PS2 is blocking.** This is a newly fatal false verdict even though exact-name comparison predates the commit.

Correction: distinguish emulator-specific filename requirements from directory requirements. For PCSX2, known-good BIOS content directly in the configured directory should not block merely because its basename differs. Keep exact names for cores that require them. Add this regression alongside the existing genuinely misplaced FDS case.

Primary evidence: [PCSX2 BIOSSettingsWidget::populateList](https://github.com/PCSX2/pcsx2/blob/master/pcsx2-qt/Settings/BIOSSettingsWidget.cpp#L51-L70) searches `*` and calls `IsBIOS` for each result.

### [P2] Keep location validation when a ZIP's whole-file hash is inconclusive

Locations: `src-tauri/src/engine/bios_validator.rs:81-85,203-212`.

An unrecognized `neogeo.zip` anywhere in the BIOS tree becomes `PresentHashMismatch` from the filename-only fallback. Because the rule is compressed, `hash_inconclusive` then waives blocking, even if the only copy is `bios/misc/neogeo.zip`, outside every accepted location. Conversely, recognized bytes at exactly that unusable location become `PresentWrongPath` and do block. Repacking the same archive therefore changes the location verdict despite FBNeo still being unable to find it.

Independent engine reproduction: create only `lib.file("bios/misc/neogeo.zip", b"unrecognized zip bytes")`, sweep, and assert Neo Geo is blocking. **Fails: Neo Geo is not blocking.** Arbitrary bytes are sufficient to reproduce the filename/location branch; no claim is made that those bytes are an actual usable ZIP. The same branch handles valid repacked archives whose overall hash is not in the list.

Correction: track presence at an accepted path independently from hash recognition. Allow a different ZIP hash to remain a warning only when a copy exists where the core reads it; do not use an inaccessible-to-the-core backup as evidence of installed firmware. Test recognized and unrecognized hashes at both accepted and rejected paths.

Primary evidence: [Libretro FBNeo BIOS search locations](https://docs.libretro.com/library/fbneo/#bios). These include the current romset's directory and the system directory's `fbneo/` subdirectory or root, not an arbitrary `misc/` subdirectory. Adjacent ROM-folder paths in the rules also assume the game is actually in that folder; the validator currently receives no game location, so that broader assumption remains unverified.

### Verification and scope

- **52 frontend tests passed**, including the real-store remount, project isolation, and empty-override tests. TypeScript `tsc --noEmit` completed successfully.
- **43 Rust unit tests and all 15 existing scenario tests passed** during the run with the three independent reproductions. All three added reproduction tests failed as described above; the focused reproduction run independently repeated all three failures. The real-library smoke scenario returns early without its opt-in environment variable and is not a real-library validation.
- Review tests were added only temporarily to the isolated worktree and then removed. No application source was changed. Existing dependencies and compiled artifacts were reused for checks; no dependencies were installed.
- Reviewed all 25 shipped BIOS entries across the 12 sweep systems for the changed blocking logic. Required nonregional rules still block when missing/wrong-path; optional Dreamcast/DS/32X entries do not become mandatory. Complete-region enumeration excludes NotApplicable entries without allowing an empty region to satisfy the requirement. The deliberate library-region limitation remains as documented by Claude.
- Verified new `also_accepted_paths` / `only_emulators` fields have Serde defaults and camelCase serialization matching optional TS arrays. Existing persisted rules missing these fields remain deserializable. No changed command argument or wrapper mismatch found. Used the project's tauri-contract-sync guidance in read-only review mode; the Rust test build also compiled the changed model/callers.
- Independently confirmed Sega CD US hash `854b9150240a198070150e4566ae1290` against [Libretro Genesis Plus GX documentation](https://github.com/libretro/docs/blob/master/docs/library/genesis_plus_gx.md#bios). Checked Saturn behavior and FBNeo locations against the primary sources linked above. This was not a fresh primary-source audit of every legacy hash.
- The conflict risk/banner changes still do not enable planning for conflict roots, and migration execution remains unavailable. No new save-overwrite route identified.
- Did not rerun native desktop checks, production build/installer, Linux/macOS, dependency audit or lint. Genuine BIOS dumps and actual emulator launches were not used; independent verdict reproductions use legal placeholder bytes and fixture hashes plus upstream source evidence.

### Next handoff

**Send to Claude first. Antigravity is not needed to establish or fix these three reproducible findings.** Ask Claude to correct them, preserve the path-retention fix, add regression scenarios, and refresh CURRENT.md with the new commit and checks.

Afterward, manually ask Antigravity to recheck typed/cleared save-root retention and project isolation, regional BIOS wording, and consistency between Dashboard and BIOS badges. Native emulator validation of the corrected Kronos/PCSX2 cases is useful if locally owned BIOS dumps and configured emulators are available; otherwise explicitly report that coverage as unavailable. Keep screenshots, test locations and exact tested commit in GEMINI-QA.md, without private paths or copyrighted dumps. No messages to other agents, commit, push, or GitHub review were sent by this pass.
