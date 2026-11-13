# PRD Amendment: Romio as checker and front panel

**Status:** Draft. The owner has set the direction and made the five decisions below; not yet reviewed.
**Amends:** `RetroLibrary_PRD_v2.docx`. Section numbers below are that document's. Where the
two differ, this amendment wins once it is accepted. Everything it doesn't mention stands.

## Why

The PRD describes a compatibility and hygiene layer: Romio tells you whether a library
will work on a given frontend and emulator. A survey of the tools retrogamers use to
prepare a library (November 2026) shows that this is one slice of a five-stage job:

| Stage | What people need | Romio today |
|---|---|---|
| 1. Audit | Verify dumps against reference catalogs (DAT files), rename, list what's missing | Nothing |
| 2. One game, one ROM | Keep one preferred copy of each game | Nothing |
| 3. Convert | Compress disc images, write multi-disc playlists | Reports problems; playlists are specified, not built |
| 4. Headers, patches, firmware | Strip copier headers, apply patches, check BIOS files | BIOS check only |
| 5. Metadata and artwork | Scrape for the frontend | Nothing |

The owner wants Romio to be the one tool a retrogamer opens for all of it. Mature
open-source tools already do stages 1 to 5 well. Most are command-line programs with no
interface. Rebuilding them would take years, and every one of them writes to libraries,
which is where Romio's own write design took five review rounds to make one file creation
safe.

## The new direction

Romio is two things:

1. **The checker.** What the PRD already describes, unchanged.
2. **A front panel for the tools that do the rest.** Romio finds the problem, then runs the
   established tool for it, with a form in place of command-line flags, a preview before
   anything happens, and the result written to a new folder.

Romio does not reimplement auditing, deduplication, compression, patching or scraping.

### Positioning (replaces the second paragraph of §23)

Romio is not another frontend, not an emulator, not an emulator installer and not a BIOS
distribution service. It does not replace the ROM managers, converters and scrapers the
community already trusts. It tells you what is wrong, and it drives those tools for you so
that fixing it doesn't mean learning five command lines.

## What changes in the PRD

| Section | Change |
|---|---|
| §3 Vision | Add a question Romio answers: "Which tool fixes this, and can Romio run it for me?" |
| §4 Goals | Add a primary goal: cover the whole preparation pipeline by driving established tools, not by reimplementing them. |
| §5 Non-Goals | All stand. Add the four below. |
| §7 Principles | Add the three below. |
| §8 Scope | Add tool adapters, starting with one. In-place format remediation leaves version 1. |
| §12.9 Export | Becomes the main way Romio changes anything: a new copy in a new folder. |
| §12.11 Rollback | Deferred, as decided for the write backbone on 2026-11-12. Nothing that changes, moves or removes an existing file ships before a rollback spec. |
| §17 Legal | Add the three requirements below. |
| §22 Post-MVP | "Format conversion workflows with rollback" becomes conversion through an adapter into a new folder, which needs no rollback. |

### Added non-goals (§5)

Romio will not:

- Reimplement DAT auditing, one-game-one-ROM selection, compression, patching or scraping.
- Run any tool in a mode that changes, moves or deletes files in the user's library.
- Bundle or redistribute reference catalogs (DAT files). The user supplies them.
- Download and run a tool without the user choosing to, in version 1.

### Added principles (§7)

| Principle | What it means in practice |
|---|---|
| Use the tool that already does it | Before building a capability, check whether an established tool has it. If one does, Romio drives that tool. |
| Originals are never touched | A tool Romio runs reads the library and writes to a separate output folder. Romio never offers a tool's move, clean or in-place options. |
| Show the command | Whatever Romio runs, the user can see the exact command and run it without Romio. |

### Added legal requirements (§17)

The product must:

- Respect each tool's licence. Running a tool as a separate program is the default. Shipping
  a tool inside Romio requires shipping its licence and meeting its source terms.
- Point only to a tool's official source. Romio never mirrors a tool.
- Treat DAT files as user-supplied artifacts, with the same neutral language as BIOS files.

## Tool adapters

An adapter is the piece of Romio that knows one tool. The first is for Igir, because one
tool covers auditing, one-game-one-ROM selection, playlists, header stripping, patching
and archiving.

Each adapter shall:

- **Find the tool** on the machine, read its version, and refuse versions it doesn't know.
  Reading a tool's output breaks when the format changes.
- **Offer a form** for the options that matter, in plain words, prefilled from the project:
  Romio already knows the target frontend and emulators.
- **Preview** what the tool would do before it does it, using the tool's own dry run or
  report where it has one.
- **Run** the tool with progress and Stop, passing arguments as a list, never as a shell string.
- **Write only to an output folder** the user confirmed, outside the library roots.
- **Record the run** in the operation log: the command, the tool and its version, the
  output folder, and how it ended.
- **Report failure plainly**, with the tool's own message.

There is no general plugin system in version 1. The second adapter is written by hand like
the first, and only then is what they share pulled out.

**What Romio can't promise.** The write backbone proves that Romio's own code touches
nothing it didn't create. An adapter can't prove that about someone else's program. The
promise here is narrower: Romio asks the tool only for operations that read the library
and write elsewhere, and shows the command it used.

## New read-only checks

The survey also names failures no tool reports and Romio could, as rules in its data files.
Each needs checking at its source before it is encoded:

- Formats that break RetroAchievements tracking.
- Arcade sets whose version doesn't match the emulator core, and merge types a
  folder-scanning frontend can't list.
- Copier headers where the emulator needs a headerless file.
- BIOS files in the wrong folder or the wrong letter case on a case-sensitive system.
- Formats that need a minimum emulator version, or can't be restored to the original.

These are in scope for the checker and need no adapter.

## Decisions

Decided by the owner on 2026-11-13.

1. **Finding tools.** Version 1 finds a tool the user installed and links to its official
   download. Installing for the user comes later, with a pinned version and a checked hash.
2. **Playlists.** Romio keeps its own writer (write backbone, PR #54), since it is small and
   needs no tool. No further native writers are built.
3. **DAT auditing.** Igir's report, through the adapter. A native read-only audit is built
   only if Romio's own checks need verified-dump status and the adapter can't supply it.
4. **Copies, not links.** The output folder holds copies in version 1. Hard links save
   space but tie the output to the library's drive.
5. **This document.** It stays an amendment beside the Word file so it can be reviewed as a
   diff, and is folded into a `v3` of the PRD once accepted.

## Order of work

1. A spike: drive Igir from Romio against a generated library, report only, then a copy
   into an output folder. It answers whether find, preview, progress and Stop are workable
   on Windows, macOS and Linux.
2. A spec for the adapter, reviewed before any code, like the write backbone.
3. The read-only checks, which don't depend on either.

The six screens in the feature roadmap continue. Export Planner is the one this changes:
it becomes the screen where adapter runs are planned.

## Risks

- **A tool misbehaves.** Romio can restrict what it asks for, not what the tool does.
- **Output parsing.** Each supported tool version is a maintenance cost.
- **Availability.** A tool may have no official build for a platform, or stop being
  maintained; the survey notes two widely used ones that have.
- **Support.** Users will bring a tool's bugs to Romio.
- **The survey itself.** Its version numbers and claims are unverified, and most of its
  sources are one tool's documentation.
