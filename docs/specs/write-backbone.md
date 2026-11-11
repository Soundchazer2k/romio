# Write Backbone — Design Spec

**Status:** Draft for Codex review. No code yet.
**Scope:** The one path every write to a user's library goes through, plus the first feature
on it (M3U playlists). Pointer files, format fixes, save migration, shortcuts and export
follow as separate specs that only define their own plans.

## Problem

Romio writes nothing to a library today. Six features need to (roadmap phase 2). If each
writes on its own, each gets its own preview, its own undo and its own failure handling,
and one of them will get it wrong on someone's only copy of a game. The PRD's rules are:
preview before every write, a log of every operation, and rollback of anything reversible.

## Rules

1. A write happens only by applying a **change plan** the user has seen in full.
2. Romio never overwrites or deletes a file it didn't create. Version 1 has no overwrite and no delete at all.
3. Every path a plan touches is inside the project's library roots. Save migration alone may
   also touch save roots, and only with a checkpoint.
4. A plan is checked against the disk again at the moment it's applied. If anything it
   relied on has changed, nothing is written.
5. A plan that fails halfway is undone. If it can't be undone, the log says exactly what is left.
6. Every applied plan is one entry in the operation log, with enough detail to reverse it.

## The change plan

```rust
pub struct ChangePlan {
    pub id:         Uuid,
    pub project_id: String,
    pub kind:       String,        // "m3u", "scummvm_pointer", ...
    pub summary:    String,        // "Write 3 playlists in psx"
    pub operations: Vec<FileOp>,
    pub created_at: DateTime<Utc>,
}

pub enum FileOp {
    /// Write a new text file. Fails if anything is already at `path`.
    CreateFile { path: String, contents: String },
    /// Rename a file within its folder. Fails if `to` exists or `from` changed since planning.
    Rename { from: String, to: String, size: u64, modified: DateTime<Utc> },
}
```

- Plans are built by pure engine functions (`engine::multidisc::plan_m3u`, ...) that read
  the disk and write nothing.
- The backend keeps pending plans in memory, keyed by id. The frontend gets the plan to
  show, and sends back **only the id** to apply it. A plan can't be edited in the webview
  and sent back, and a plan is gone when the app closes.
- Binary writes, directory moves and copies aren't in version 1. Save migration's spec adds
  what it needs.

## Flow

```text
plan_*(project_id, ...)        -> ChangePlan        (reads only; stored as pending)
  UI: ChangePreview modal lists every operation: full path, and the file's contents
  for CreateFile. One primary button: "Write N files" / "Rename N files". Cancel discards.
apply_plan(plan_id)            -> ApplyResult
  1. confine:  every path resolves inside a library root (canonical parent, no symlink escape)
  2. recheck:  every op's precondition still holds; if not, return blockers, write nothing
  3. apply ops in order, noting each completed op
  4. on failure: undo completed ops in reverse, return the error and what was undone
  5. write one operation_log row (plan JSON included) in a transaction
rollback_operation(log_id)     -> RollbackResult
  reverse each op, last first, only where it is still safe (below); mark rolled_back
```

`apply_plan` and `rollback_operation` run in `spawn_blocking`.

## Preconditions and undo, per operation

| Operation | Apply only if | Undo / rollback only if |
|---|---|---|
| `CreateFile` | nothing exists at `path`; parent folder exists | the file's bytes still equal what Romio wrote. Otherwise leave it and report "changed since Romio wrote it" |
| `Rename` | `from` exists with the recorded size and modified time; nothing exists at `to` | `to` exists and nothing exists at `from` |

`CreateFile` opens with `create_new`, so a file that appears between the recheck and the
write still fails instead of being overwritten.

A rollback can be partial. The result lists each operation as undone or skipped with the
reason, and the log entry is marked rolled back only when every operation was undone.

## Data

Migration `005_operation_plan.sql` adds `plan_json TEXT` to `operation_log`. Entries
without it (existing checkpoints) are not reversible and show no rollback control.
If the log row can't be written after a successful apply, the apply is undone and reported
as failed: a write Romio can't reverse later must not stand.

## Screens

- **Change Preview** is the shared `ChangePreview` modal, opened by each feature. It is not
  a sidebar screen: a plan only exists while its feature is open. The `preview` screen id is removed.
- **Rollback History** is a sidebar screen: the project's operation log, newest first, each
  entry with its summary, time, the files touched, and a Roll back button where reversible.
  Rolling back opens the same modal, showing what will be undone.

## First feature: M3U playlists

- From the Multi-Disc screen, each set with a missing playlist gets a checkbox. Nothing is
  selected by default (PRD: never group without explicit confirmation).
- `plan_m3u(project_id, sets)` creates one `CreateFile` per set: `<set name>.m3u` beside the
  discs, one disc per line in disc order, file names only (relative, so the library can
  move), `\n` line endings, UTF-8 without a byte-order mark.
- A set whose discs have missing track files, or whose playlist exists but is incomplete,
  can't be selected. Incomplete playlists are the user's file; Romio reports them only.
- After writing, the screen rescans.

## Testing

- Scenario tests on fake libraries: apply then rollback leaves the folder byte-identical;
  a target that appears before apply blocks the whole plan; a failure on the second op
  undoes the first; a created file edited afterwards is skipped by rollback; a path outside
  the library root (including through a symlink) is refused.
- Codex reviews this spec, then each PR. Gemini checks each write feature on the desktop
  against a throwaway copy of a library.

## Open questions

1. **Disc files still show as games.** With a playlist beside the discs, ES-DE, RetroBat
   and Batocera list the playlist and every disc. Hiding the discs means moving them into
   a subfolder, a folder named `<game>.m3u`, or editing `gamelist.xml`. Each differs per
   frontend, and the last one edits a frontend's own file. Version 1 writes the playlist
   only and says the discs will still be listed. Which approach comes next?
2. **Should a plan survive a restart?** In memory is simplest and safest. A saved plan
   would need rechecking anyway.
3. **Export** needs to write outside the library roots. Its spec has to define that
   destination and how the user confirms it.
