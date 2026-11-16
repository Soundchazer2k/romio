# Feature Roadmap

**Goal:** Make Romio the one tool a retrogamer opens to get a library ready: its own checks,
plus a front panel for the established tools that do the rest
(`docs/prd/2026-11-13-toolkit-direction.md`).

**Approach:** Build in small PRs and review as we go, with the depth of review set by
how hard a mistake is to undo. Checks come before anything that writes, and Romio's own
small writes come before running other people's programs.

Revised on 2026-11-13. The first version of this plan covered the six placeholder screens
only. What it listed as done is kept below so the numbering in old PRs still makes sense.

## Review rules

| Kind of change | Codex | Gemini (desktop QA) |
|---|---|---|
| Foundation change | Every PR | Batched with the next screen |
| Read-only screen or check | Every PR | Once per batch of two or three |
| Anything that writes to a library or save folder | Spec first, then every PR | Every PR, on a throwaway copy of a library |
| Anything that runs an external tool | Spec first, then every PR | Every PR, on a throwaway copy of a library, with the real tool |

- One feature per PR. The user triggers each review and pastes the report back.
- Every reviewer claim is checked at source. Rejected claims are listed with the reason.
- Desktop checks use generated libraries of empty files, never a real library.
- A screen goes back into `NAV` in `Sidebar.tsx` in the PR that ships it.
- A rule that comes from research is checked at its own source before it goes into a data file.

## Done

- **Format Check state** (PR 48), **blocking commands** (PR 49): merged.
- **Multi-Disc, ScummVM and Installed Titles, report-only** (PR 53): merged.

## Phase 0: Foundations

1. **Project switching** (PR 57): reviewed by Codex. Needs Gemini on the desktop: it is
   the first time per-project sessions can be reached without a restart.
2. **Scan progress carries its scan's identity** (PR 59, stacked on PR 57). Progress events have no project or run
   id, so an event that arrives late can show under the next scan's project. A small
   backend change to the event, and the listener drops events that don't match.

## Phase 1: More checks

Read-only, and independent of everything below. Each is a rule in the data files, checked
at its source first. The first pass at checking them (2026-11-16) cut this list down:

3. **Arcade sets:** a set version that doesn't match the emulator core, and merge types a
   folder-scanning frontend can't list. Needs its own short design, since Romio has no
   arcade model yet.
4. **BIOS letter case for a case-sensitive target.** Romio already reports a BIOS file in
   the wrong folder (`PresentWrongPath`), and on a Linux host a wrong-case name counts as
   wrong. The gap is a library prepared on Windows or macOS for a Linux frontend: the name
   matches here and won't there. Romio doesn't know the target's filesystem, only its
   frontend, so this needs a design decision first: ask for the target platform, or warn.

Looked at and not built:

- **Formats that break RetroAchievements.** The survey says `.cso` and `.pbp` do. That
  didn't hold up: RetroAchievements' own identification page names no container formats,
  and user reports differ by emulator and frontend. There is no source to encode a rule from.
- **Copier headers.** No emulator in the format matrix rejects a headered file. Stripping
  headers matters for patches and flashcarts, which is adapter work (phase 3).
- **Minimum emulator versions.** Already there: rules carry `sinceVersion`, and PSP `.chd`
  on PPSSPP 1.17 is encoded.

## Phase 2: Romio's own writes

Create-only. Romio never changes, moves or removes an existing file here.

5. **Write backbone** (spec in PR 54): one path for every write. Build a plan, show it in
   the Change Preview modal, apply it, record it. No rollback in version 1.
6. **History screen:** what Romio wrote, and whether each file is there now.
7. **Playlist generation** (Multi-Disc), the first feature on the backbone.
8. **Pointer files** (ScummVM) and **shortcut generation** (Installed Titles): each needs
    its own spec, which must show it only creates new files. If it can't, it moves to phase 4.

No further native writers are planned. What else needs writing goes through an adapter.

## Phase 3: Tool adapters

Romio runs an established tool: a form in place of flags, a preview, output to a new or
empty folder outside the library. Every run against a library is recorded before it
starts; reading a tool's version when the user chooses it is not. Igir is first.

9. **Spike:** drive Igir from Romio against a generated library. Report only, then a
    copy into an output folder. It answers whether finding the tool, preview, progress and
    Stop are workable on Windows, macOS and Linux. Throwaway code.
10. **Adapter spec,** reviewed before any code.
11. **Igir, report only:** audit a library against DAT files the user supplies, and show
    what is verified, unknown and missing. Writes nothing to the library: the tool's
    report and cache go in Romio's own data folder.
12. **Export Planner, through Igir:** a clean copy of the library for a frontend, in a new
    or empty folder: one copy of each game, renamed, headers stripped and patches applied where
    asked. Copies, not links.
13. **A second adapter,** chosen after item 12 ships. Disc compression is the likely
    candidate. Only then is what the two adapters share pulled out.

## Phase 4: Waiting on a rollback spec

Nothing here starts until a rollback spec is merged, because each changes, moves or
removes existing files.

- **Save migration,** `execute_migration`.
- **Format fixes in place.** Most of this need is met by item 12, which writes a fixed copy.
- **Hiding a playlist's discs** from frontends that list them.

## Phase 5: Release check

14. One full Gemini journey through every screen on a throwaway library, with the real
    tools installed, then fix what it finds.

## Open questions

- Which frontends Export supports at launch.
- Scraping (metadata and artwork) is the one pipeline stage with no plan here.
- Whether Romio should ever install a tool for the user. Version 1 uses an installed copy
  the user points it to, and links to the official download.
