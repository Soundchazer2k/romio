# Feature Roadmap: Remaining Screens

**Goal:** Build the six placeholder screens (Multi-Disc Toolkit, ScummVM Workspace,
Installed Titles, Export Planner, Change Preview, Rollback History) without piling up
untested work.

**Approach:** Build in small PRs and review as we go, with the depth of review set by
how hard a mistake is to undo. Fix shared foundations first, because every later screen
copies their patterns.

## Review rules

| Kind of change | Codex | Gemini (desktop QA) |
|---|---|---|
| Foundation fix | Every PR | Batched with the next screen |
| Read-only screen | Every PR | Once per batch of two or three screens |
| Anything that writes to a library or save folder | Spec first, then every PR | Every PR, on a throwaway copy of a library |

- One feature per PR. The user triggers each review and pastes the report back.
- Every reviewer claim is checked at source. Rejected claims are listed with the reason.
- Desktop checks use generated libraries of empty files, never a real library.
- A screen goes back into `NAV` in `Sidebar.tsx` in the PR that ships it.

## Phase 0: Foundations

1. **#48 Format Check state:** waiting on Codex for the Gemini fixes.
2. **Project switching** (`feat/switch-projects`): built, follows #48. Needs `master`
   merged in, then a PR.
3. **Blocking commands:** commands that read or hash files run on the async workers, so
   a stalled drive can stall the whole app, as Format Check did before #48. Move them to
   `spawn_blocking`: `validate_bios`, `revalidate_bios`, `discover_save_roots`,
   `create_migration_plan`, `create_save_checkpoint`, `check_host_environment`.

## Phase 1: Read-only screens

Each one detects and reports. None writes anything.

4. **Multi-Disc Toolkit, detection:** `detect_multidisc_sets` finds disc sets by name and
   CUE sheet and shows which lack an M3U. M3U generation waits for phase 2.
5. **ScummVM Workspace, detection:** `detect_scummvm_games` finds game folders and shows
   which need a pointer file. Pointer generation waits for phase 2.

   *Gemini batch 1: items 3 to 5.*

6. **Installed Titles, validation:** checks title IDs and launch commands with the
   existing `shortcut_validator`. Shortcut generation waits for phase 2.

   *Gemini batch 2: item 6, with a pass over project switching.*

## Phase 2: Writes

Spec first for each, reviewed by Codex before any code. Each spec covers what is written,
where, how it is previewed, how it is undone, and what happens if it fails halfway.

7. **Write backbone:** one path for every write: build a plan, show it in **Change
   Preview**, take a checkpoint, apply, record it in the operation log. **Rollback History**
   lists the log and undoes an entry. Save migration's checkpoint and log are reused.
8. **M3U generation** (Multi-Disc).
9. **Pointer files** (ScummVM).
10. **Format fixes:** Apply Fixes comes back, through the backbone. Each staged fix is
    re-checked against the disk before writing.
11. **Save migration:** `execute_migration` through the backbone.
12. **Shortcut generation** (Installed Titles).
13. **Export Planner:** `plan_export`, dry run, then `execute_export`, per frontend,
    tier 1 first.

## Phase 3: Release check

14. One full Gemini journey through every screen on a throwaway library, then fix what it
    finds.

## Open questions

- Which frontends Export supports at launch. All eight are listed, but tier 2 could wait.
- Whether Change Preview is its own screen or a step inside each write flow. The plan
  assumes a shared component that each flow opens, with the screen listing pending plans.
