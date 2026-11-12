# Write Backbone — Design Spec

**Status:** Draft, revised after Codex review of `a450cdb`. No code yet.
**Scope:** The one path every write to a user's library goes through, plus the first feature
on it (M3U playlists). Pointer files, format fixes, save migration, shortcuts and export
follow as separate specs that only define their own plans.

## Problem

Romio writes nothing to a library today. Six features need to (roadmap phase 2). If each
writes on its own, each gets its own preview, its own undo and its own failure handling,
and one of them will get it wrong on someone's only copy of a game. The PRD's rules are:
preview before every write, a log of every operation, and rollback of anything reversible.

## What this protects against

The library changing under Romio by accident: the user, a frontend, a scraper or a sync
tool touching files between the preview and the write, or the app or machine stopping
halfway. It does not try to defend against a hostile program already running as the user.
That program can edit the library directly, and beating it would mean holding folder
handles through every operation, which the standard library doesn't offer portably. The
checks below are chosen for the first case and are honest about the second.

## Rules

1. A write happens only by applying a **change plan** the user has confirmed, once.
2. Romio never overwrites or deletes a file it didn't create. Version 1 has no overwrite and no delete at all.
3. Every path a plan touches is inside the project's library roots. Save migration alone may
   also touch save roots, and only with a checkpoint.
4. Each operation is checked against the disk again immediately before it runs, and runs
   with a primitive that refuses to replace an existing file.
5. What Romio is about to do is on disk, in the journal, before the first file is touched.
   An interrupted plan is found again at the next start.
6. A plan that fails halfway is undone. What can't be undone stays in the journal, visible and retryable.
7. Rollback reverses only files that are still the ones Romio wrote or moved.

## The change plan

```rust
pub struct ChangePlan {
    pub id:         Uuid,          // v4, made by the backend
    pub project_id: String,
    pub roots:      Vec<String>,   // the project's library roots when the plan was built
    pub kind:       String,        // "m3u", "scummvm_pointer", ...
    pub summary:    String,        // "Write 3 playlists in psx"
    pub operations: Vec<FileOp>,
    pub created_at: DateTime<Utc>,
}

pub enum FileOp {
    /// Write a new text file. `requires` are files that must still exist when it is written
    /// (a playlist's discs).
    CreateFile { path: String, contents: String, requires: Vec<String> },
    /// Rename a file within its folder.
    Rename { from: String, to: String, was: Fingerprint },
}

/// Enough to tell "the same file, unchanged" from "a file at the same path".
pub struct Fingerprint {
    pub size:     u64,
    pub modified: DateTime<Utc>,
    pub file_id:  Option<String>,  // volume and file index, or device and inode; None where the filesystem has none
    pub sha256:   Option<String>,  // text files Romio wrote; None for a renamed game file, which is too large to hash twice
}
```

- Plans are built by pure engine functions (`engine::multidisc::plan_m3u`, ...) that read
  the disk and write nothing. A planner takes what the user picked (a folder and a set
  name) and reads the files itself. It never trusts file lists sent from the webview.
- Binary writes, directory moves and copies aren't in version 1. Save migration's spec adds
  what it needs.

### Pending plans

The backend keeps pending plans in memory, keyed by id. The frontend gets the plan to show
and sends back only its id and project id.

- **One use.** `apply_plan` removes the plan from the map before doing anything else, under
  the map's lock. A second call with the same id, at the same time or later, finds nothing
  and is refused.
- **One at a time.** A project has one apply or rollback running at once. Another is refused, not queued.
- **Bound to its project.** The id must belong to the project id sent with it, the project
  must still exist, and its library roots must equal the plan's `roots`. Otherwise the plan
  is dropped and the user is told to preview again.
- **Short-lived.** A plan is dropped when its preview is cancelled (`discard_plan`), ten
  minutes after it was built, when its project is deleted or its roots change, and when the app closes.
- An id that is already in the map is never replaced; a new plan gets a new id.

The backend can enforce that a plan is applied once, unchanged, for the project it was
built for. It cannot prove a person read the preview. The preview is the frontend's job.

## Flow

```text
plan_*(project_id, ...)            -> ChangePlan     (reads only; stored as pending)
  UI: ChangePreview modal lists every operation: full path, and the file's contents
  for CreateFile. One primary button: "Write N files" / "Rename N files". Cancel discards.
apply_plan(plan_id, project_id)    -> ApplyResult
  1. claim:    take the plan out of the pending map; check project and roots
  2. confine:  every path is inside a library root (below)
  3. recheck:  every op's precondition holds; if not, return blockers, write nothing
  4. journal:  insert the operation_log row, status "applying", with the record. If this
               fails, stop: nothing has been written.
  5. per op:   confine and recheck this op again, run it, fingerprint the result, and save
               the op's state to the journal row
  6. on failure: undo completed ops in reverse, saving each outcome; status "failed"
  7. status "applied"
rollback_operation(log_id)         -> RollbackResult
  reverse each op, last first, only where it is still safe (below), saving each outcome
```

`apply_plan` and `rollback_operation` run in `spawn_blocking`.

## Confinement

Checked for the whole plan before the journal row, and again for each operation right before it runs.

- The path's parent folder is made canonical and must sit under one of the plan's roots,
  compared component by component (so `C:\lib2` is not inside `C:\lib`), case-insensitively
  on Windows and macOS, with UNC and drive roots compared in canonical form.
- A path with a `..` component is refused outright, not resolved.
- No component between the root and the file may be a symlink, a junction or any other
  reparse point. The file itself may not be one either. Libraries built on symlinks are
  refused in version 1 with a message that says why.
- The file name must be valid on Windows as well: no reserved names, no trailing dot or space.

What this leaves open: a folder swapped for a link in the moment between the check and the
call. See "What this protects against".

## Preconditions, per operation

| Operation | Apply only if | How it is written |
|---|---|---|
| `CreateFile` | nothing exists at `path`; the parent folder exists; every `requires` path is a regular file | written in full to a temporary file in the same folder, flushed, then moved to `path` with a no-replace rename. A reader never sees half a file. |
| `Rename` | `from` is a regular file matching `was` (size, modified time, and file id where there is one); nothing exists at `to` | a no-replace rename |

**No-replace rename.** `std::fs::rename` replaces an existing file on every platform, so it
isn't used. Windows: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`. Linux:
`renameat2` with `RENAME_NOREPLACE`. macOS: `renamex_np` with `RENAME_EXCL`. Where the
filesystem doesn't support the call, the operation is refused with "this drive can't do a
safe rename". There is no check-then-rename fallback: that is the race this rule exists to close.

The temporary file's name is recorded in the journal before it is created, so a leftover
one can be recognised and removed at recovery.

## The journal

Migration `005_operation_journal.sql` adds to `operation_log`:

- `status`: `applying`, `applied`, `failed`, `rolling_back`, `rolled_back`, `partly_rolled_back`
- `record_json`: a versioned record

```json
{ "version": 1,
  "plan": { ... the ChangePlan ... },
  "ops": [ { "state": "pending | started | done | undone | undo_failed | skipped",
             "temp_path": "...", "after": { fingerprint }, "note": "why skipped or failed" } ] }
```

- The row is written, and committed, before the first file is touched. Each op's state is
  saved before it starts (`started`) and after it finishes (`done`, with the fingerprint of
  the file as Romio left it).
- A record whose `version` this build doesn't know is shown read-only, with no rollback control.
- Entries without a record (existing checkpoints) are not reversible and show no rollback control.
- If saving an op's state fails after the file operation succeeded, the apply stops and
  undoes what it did. If that also fails, the row still says `applying`, which recovery handles.

### Recovery at start

Any row left in `applying` or `rolling_back` was interrupted. On start, for each one:

- An op marked `done` is trusted. An op marked `started` is settled by looking at the disk:
  a leftover temporary file is removed; a `CreateFile` whose final file matches the planned
  contents counts as done; a `Rename` where `to` exists and `from` doesn't counts as done.
  Anything else is marked unknown, with what was found.
- The row becomes `failed` and is listed in Rollback History as interrupted, with each
  operation's state. The user can roll back what was done. Nothing is reapplied automatically.

## Rollback

Each reverse operation is confined and checked the same way as an apply.

| Operation | Reversed only if | Otherwise |
|---|---|---|
| `CreateFile` | the file at `path` matches the `after` fingerprint: same size, same hash, and the same file id where there is one | left alone, reported as "changed or replaced since Romio wrote it" |
| `Rename` | the file at `to` matches `after` (size, modified time, file id), and nothing exists at `from` | left alone, reported as changed, replaced, missing, or "the old name is taken" |

- Removing a file Romio created is the one delete in version 1, and only on a fingerprint match.
- Every outcome is saved per operation, so a second rollback retries only what was skipped
  and never reverses the same operation twice.
- The entry is `rolled_back` when every operation was undone, `partly_rolled_back` otherwise.
- On a filesystem with no file ids, a renamed file is matched by size and modified time
  alone. The preview says so before the rename is applied.

## Screens

- **Change Preview** is the shared `ChangePreview` modal, opened by each feature. It is not
  a sidebar screen: a plan only exists while its feature is open. The `preview` screen id is removed.
- **Rollback History** is a sidebar screen: the project's operation log, newest first, each
  entry with its summary, time, status, the files touched, and a Roll back button where
  reversible. Interrupted and partly rolled back entries are marked and stay at the top
  until resolved. Rolling back opens the same modal, showing what will be undone.

## First feature: M3U playlists

- From the Multi-Disc screen, each set with no playlist gets a checkbox. Nothing is
  selected by default (PRD: never group without explicit confirmation).
- `plan_m3u(project_id, picks)` takes a folder and set name per pick and detects the set
  again from disk. It creates one `CreateFile` per set: `<set name>.m3u` beside the discs,
  one disc per line in disc order, file names only (relative, so the library can move),
  `\n` line endings, UTF-8 without a byte-order mark. Each disc, and each track file its
  sheet names, goes in `requires`.
- A set can't be selected when:
  - its discs have missing track files, or a sheet that couldn't be checked;
  - a playlist for it exists in any state, including one named after the set that is
    unreadable or lists nothing real. Those are the user's files; Romio reports them only;
  - a disc's file name starts with `#` (a comment line in a playlist), contains a line
    break or control character, or isn't valid UTF-8;
  - its playlist name would collide with another pick's, or with an existing file, compared
    without regard to case.
- The planner checks collisions across the whole plan, not per set.
- After writing, the screen rescans.

## Testing

- Scenario tests on fake libraries:
  - apply then rollback leaves the folder byte-identical;
  - a target that appears before apply blocks the whole plan, and one that appears between
    the recheck and the write fails that operation without replacing anything;
  - a failure on the second op undoes the first;
  - a created file edited afterwards, or replaced by a different file with the same bytes,
    is skipped by rollback (the second where the filesystem has file ids);
  - a path outside the library root, through `..`, a symlink or a junction, or in a
    sibling folder whose name starts with the root's, is refused;
  - the same plan id applied twice, or from two threads at once, writes once;
  - a plan whose project's roots changed is refused;
  - a journal row left in `applying` with a leftover temporary file, a finished file, or
    neither, is settled correctly at start;
  - a disc that disappears after the preview blocks its playlist.
- Not testable in CI: a real power loss, and a filesystem without no-replace rename. The
  second gets a unit test of the refusal path with the call stubbed.
- Codex reviews this spec, then each PR. Gemini checks each write feature on the desktop
  against a throwaway copy of a library, including killing the app mid-apply.

## Decisions on the earlier open questions

Codex's recommendations, adopted here pending the owner's word.

1. **Disc files still show as games.** Version 1 writes the playlist only and keeps the
   discs visible. Batocera and RetroBat already hide discs a playlist lists; ES-DE doesn't.
   Hiding comes later as an opt-in operation per frontend, after checking how that frontend
   indexes the layout, and never by editing a frontend's own files without its own spec.
2. **Plans don't survive a restart.** Unapplied plans are dropped. The journal does survive,
   which is what an interrupted apply needs.
3. **Export** gets its own destination root, confirmed separately by the user, with the
   same confinement, collision and journal rules applied inside it. Its spec defines the confirmation.

## Review history

- Codex on `a450cdb`: confinement and preconditions could go stale before the write; the
  log was written after the files, so a crash left no record; rollback could move or delete
  a replaced file; a plan id proved lookup, not single use; the playlist planner trusted
  its input. All five are addressed above. Not taken: binding operations to open folder
  handles, for the reason given under "What this protects against".
