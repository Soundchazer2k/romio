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

## Round 3

Final review performed 2026-11-04 against `76201d1eddc7af73cef172cdca71908ae6e7140d`, with base `d9e1e2880d959c6deb2b2ff47dd2145f629ec831`. Fetched origin, read CURRENT.md from `origin/docs/handoffs`, and followed its working-copy commands on isolated branch `codex/review-3`. Earlier rounds are unchanged.

**Merge verdict: do not merge #29 yet. Two P2 findings should block this PR because they contradict its BIOS correctness requirements.** Neither involves a save-overwrite route.

| Finding | Severity | Block merging #29? | Reason |
|:--|:--|:--|:--|
| R3-1: Kronos fallback hides corrupt preferred file | P2 | **Yes** | Newly accepted alternatives can produce PresentValid for a BIOS the core will not select; violates requirement 5. |
| R3-2: Beetle PSX checksum fallback rejected | P2 | **Yes** | A source-confirmed supported filename is classified as blocking; the new regression test encodes the opposite of upstream behavior; violates requirement 9. |
| Documented limited revision coverage, configuration-specific paths, and already deferred UI/error issues | Follow-up | **No additional blocker established** | Not re-reported as new findings; the review does not certify uninspected settings or unlisted revisions. |

### R3-1 — [P2, merge blocker] Respect Kronos file precedence before accepting a fallback

PR location: `src-tauri/src/engine/bios_validator.rs:153-169`, particularly `copies.iter().find(|(_, p)| is_in_place(p))` at line 163.

The validator selects any recognized good copy from the entire accepted-path set, without checking whether an earlier-priority file already exists with bad contents. With corrupt `bios/kronos/saturn_bios.bin` and a valid root-level `bios/mpr-17933.bin`, the result is `saturn_bios.bin = PresentValid` and Saturn is not blocking. The fallback has hidden the corrupt file the emulator actually selects.

Exact compatibility evidence: [Kronos, pinned commit d451a55, libretro.c:1619](https://github.com/FCare/Kronos/blob/d451a55253e2e75bcef704ec8ade2085d298212c/yabause/src/libretro/libretro.c#L1619-L1638) sets the preferred filename and only advances to each fallback if `does_file_exist` fails. It does not choose the first recognized-good revision across all existing candidates. [Line 1720](https://github.com/FCare/Kronos/blob/d451a55253e2e75bcef704ec8ade2085d298212c/yabause/src/libretro/libretro.c#L1720) passes that selected path to `yinit.biospath`. The claim here is about the file selected by upstream, not a claimed live emulator launch.

Independent reproduction, using the shipped rules with fixture hashes:

1. Write corrupt placeholder bytes at `bios/kronos/saturn_bios.bin`.
2. Write known-good fixture bytes for `mpr-17933.bin` at `bios/mpr-17933.bin` and add that fixture's hash to the Kronos rule's known-good alternatives (matching the shipped real-hash relationship).
3. Sweep with Saturn preference `lr-kronos`.
4. Assert that the Kronos entry is not PresentValid and Saturn blocks. **Fails: the entry is PresentValid.**

Temporary test: `review_round3_kronos_bad_preferred_file_must_not_be_hidden_by_good_fallback`.

Fix narrowly: for the ordered Kronos candidates, evaluate the file the core selects first, then classify its content. Keep legitimate fallback support when earlier candidates are absent, and keep ordinary non-selected backup copies from hiding a correct selected BIOS. Add this precedence regression alongside the existing one-file-at-a-time fallback tests.

### R3-2 — [P2, merge blocker] Correct the assumption that Beetle PSX requires the canonical filename

PR locations: `src-tauri/data/bios_rules.json:13,28,43` (PS1 any-name lists only include DuckStation); `src-tauri/src/engine/bios_validator.rs:158-163`; `src-tauri/tests/scenarios.rs:359` explicitly expects a renamed BIOS to be rejected by Beetle PSX.

Place valid US BIOS contents directly under the BIOS root as `PS1 US.bin`, with no canonical named candidate, and select `lr-beetle-psx`. Romio recognizes the bytes but returns PresentWrongPath and blocking. Current upstream Beetle PSX performs a checksum-based directory search when its named candidates are absent, so this placement is usable under that search path. The earlier assumption that Beetle Saturn's fixed-name behavior also applies to Beetle PSX is incorrect.

Exact compatibility evidence, pinned Beetle PSX commit `71ee81e77acd49296ecf4a683f5a61568ba80bf9`:

- [libretro.c:843-845](https://github.com/libretro/beetle-psx-libretro/blob/71ee81e77acd49296ecf4a683f5a61568ba80bf9/libretro.c#L843-L845): invokes `search_firmware` when named candidates were not found.
- [libretro.c:633](https://github.com/libretro/beetle-psx-libretro/blob/71ee81e77acd49296ecf4a683f5a61568ba80bf9/libretro.c#L633): enumerates the base directory without requiring the canonical basename.
- [libretro.c:660-667](https://github.com/libretro/beetle-psx-libretro/blob/71ee81e77acd49296ecf4a683f5a61568ba80bf9/libretro.c#L660-L667): checks supported image sizes, calculates SHA1, and accepts the expected checksum.

Independent reproduction: `lib.bios("bios/PS1 US.bin", "scph5501.bin")`, shipped fixture rules, `sweep_as(..., "ps1", "lr-beetle-psx", ...)`, then expect PresentValid and not blocking. **Fails: PresentWrongPath.** Temporary test: `review_round3_beetle_psx_checksum_fallback_accepts_renamed_bios`. Placeholder bytes simulate Romio's known-good hash lookup; acceptance of an actual correctly sized BIOS by upstream is established from the source, not by running placeholder bytes in an emulator.

Fix narrowly: model Beetle PSX's named-candidate/checksum-fallback behavior and correct the test that currently enforces a false rejection. Do not blindly apply the same policy to Beetle Saturn, nor ignore a corrupt named file that takes precedence over checksum search. If supporting older core versions with different behavior is intentional, record and enforce that version boundary instead of making an unconditional compatibility claim.

### Source checks and Round 2 closure

- **Beetle Saturn fixed filenames confirmed, not assumed:** [ss.c:1846-1849](https://github.com/libretro/beetle-saturn-libretro/blob/30f4c12072d265c9e553dcb29386059114945dea/mednafen/ss/ss.c#L1846-L1849) selects `sega_101.bin` or `mpr-17933.bin` by area; [ss.c:1868-1874](https://github.com/libretro/beetle-saturn-libretro/blob/30f4c12072d265c9e553dcb29386059114945dea/mednafen/ss/ss.c#L1868-L1874) opens that path under the base directory. The current handoff's Beetle PSX and Saturn assumptions must therefore be separated.
- **Round 2 Kronos single-file fallbacks:** fixed for the isolated single-candidate cases tested by `kronos_reads_its_fallback_files`; R3-1 covers the missing multiple-candidate precedence case.
- **Round 2 PCSX2 basename rejection:** fixed for the recognized revision in the configured root, confirmed by the passing scenario. Upstream [BiosTools.cpp:263](https://github.com/PCSX2/pcsx2/blob/1ccd6a8dc3574771c138849039d71951a3a1c175/pcsx2/ps2/BiosTools.cpp#L263) enumerates `*`, and [line 273](https://github.com/PCSX2/pcsx2/blob/1ccd6a8dc3574771c138849039d71951a3a1c175/pcsx2/ps2/BiosTools.cpp#L273) identifies images with `IsBIOS`. Broader revision support is still the disclosed follow-up.
- **Round 2 unrecognized Neo Geo ZIP in a rejected folder:** fixed by the revised same-name/location branch; known/unknown hash and accepted/rejected location scenarios pass. This does not validate ZIP contents or remove the disclosed assumption about the game's actual ROM directory.
- **Any-name matching does not itself relabel JP contents as US:** an additional review test put JP fixture bytes at `bios/scph5501.bin` under DuckStation; the JP entry was PresentValid while the US entry remained PresentHashMismatch. This passed. The deliberately retained region-complete product policy remains distinct from per-file identity.
- Reviewed all 25 shipped entries against the changed placement/blocking code. No further merge blocker established from optional Dreamcast/DS/32X entries, required nonregional entries, NotApplicable filtering, or empty-region handling. Arbitrary external emulator settings and unknown BIOS revisions remain outside what these rules can certify; xemu's configured MCPX path was not independently source-audited in this pass.

### Checks and boundaries

- Unmodified reviewed application: **52 frontend tests, 43 Rust unit tests and 18 scenario tests passed**; TypeScript `tsc --noEmit` passed. The opt-in real-library smoke test returned early without its environment variable, so this is not evidence of a real-library scan.
- Three additional review-only Rust scenarios: **two failed** (R3-1/R3-2), **one passed** (wrong-region content identity). Tests were temporary, in the isolated worktree only, and restored afterward. The worktree is clean; no application code or permanent tests were changed.
- `anyNameEmulators` matches `any_name_emulators` through camelCase Serde serialization and has a default empty vector; TS models expose the optional array. No new IPC contract mismatch found.
- Save root retention and conflict handling remain as reviewed in Round 2. Conflict cards still do not offer migration planning (`SavesScreen.tsx:229` requires `migration_needed`), and execution remains unavailable (`SavesScreen.tsx:477`). No newly introduced save-overwrite route identified.
- Did not launch real emulators, use genuine BIOS dumps, run native desktop/installer checks, or rerun lint, dependency audit, or production packaging. Passing fixture tests do not certify every emulator version or configuration. Existing compiler warnings were left alone.
- No commit, push, merge, GitHub review, or message to another agent was performed. Only this Round 3 report was added to the shared handoff document.

### Next action

Send this report directly to Claude for the two focused corrections and regression tests. Antigravity is not needed to establish either finding before that handoff. After fixes, a native visual pass is useful, but should be reported separately from source-backed engine validation. #29 should await the two corrections rather than being merged based only on the currently passing suites.
