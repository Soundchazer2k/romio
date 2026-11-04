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
