# Write Backbone — Design Spec

**Status:** Draft, revised after Codex's reviews of `a450cdb` and `eae265b`. No code yet.
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
That program can edit the library directly.

Two limits follow, and the rules below don't promise past them:

- **Paths, not handles.** Romio checks a path and then acts on that path. A folder that is
  moved or swapped for a link in the moment between the two can send the write somewhere
  else. Closing that needs every operation anchored to an open, validated folder handle,
  which the standard library doesn't offer portably. Version 1 doesn't do it. An ordinary
  user or sync tool can trigger this, not only a hostile one; the window is the few
  milliseconds between a check and its call.
- **Proof of ownership needs the filesystem's help.** Romio can only prove a file is the
  one it wrote where the filesystem gives files a stable identity. Where it doesn't, Romio
  still writes, but won't delete anything afterwards (see "Ownership").

## Rules

1. A write happens only by applying a **change plan**, once. The frontend shows the plan
   and asks for confirmation; the backend enforces the rest.
2. Romio never overwrites a file, and never deletes one it can't prove it created. The only
   delete in version 1 is removing a file Romio wrote, on proof that it is still that file.
3. Every path a plan touches is checked to be inside the project's library roots, when the
   plan is applied and again before each operation. The check is by path, with the limit
   stated above.
4. Each operation is checked against the disk again immediately before it runs, and
   publishes its file with a primitive that refuses to replace an existing one.
5. What Romio is about to do is durably in the journal before it does it, one step at a time.
   An interrupted plan is found again at the next start and settled from what is on disk.
6. A plan that fails halfway is undone. What can't be undone stays in the journal, visible and retryable.
7. Where Romio can't tell whether a file is its own, it leaves the file alone and says so.
8. One write runs at a time, across every project and every running copy of Romio.

## The change plan

```rust
pub struct ChangePlan {
    pub id:         Uuid,          // v4, made by the backend
    pub project_id: String,
    pub roots:      Vec<String>,   // the project's library roots when the plan was built
    pub kind:       String,        // "m3u", "scummvm_pointer", ...
    pub input:      Value,         // what the user picked; enough to build the plan again
    pub summary:    String,        // "Write 3 playlists in psx"
    pub operations: Vec<FileOp>,
    pub created_at: DateTime<Utc>,
}

pub enum FileOp {
    /// Write a new text file. `requires` are files that must still be regular files when
    /// it is written (a playlist's discs).
    CreateFile { path: String, contents: String, requires: Vec<String> },
}
```

- Version 1 has one operation. **Rename is not in it.** Proving that a multi-gigabyte game
  file is still the one Romio renamed needs either a reliable file identity or a full hash
  on every check, and playlists don't need a rename. The format-fix spec adds `Rename` with
  its own ownership rule. Binary writes, folder moves and copies wait the same way.
- Plans are built by pure engine functions (`engine::multidisc::plan_m3u`, ...) that read
  the disk and write nothing. A planner takes what the user picked (`input`) and reads the
  files itself. It never trusts file lists sent from the webview.
- A planner is deterministic: the same `input` on an unchanged library gives the same operations.

### Pending plans

The backend keeps pending plans in memory, keyed by id. The frontend gets the plan to show
and sends back only its id and project id.

- **One use.** `apply_plan` removes the plan from the map before doing anything else, under
  the map's lock. A second call with the same id, at the same time or later, finds nothing
  and is refused.
- **Bound to its project.** The id must belong to the project id sent with it, the project
  must still exist, and its library roots must equal the plan's `roots`. Otherwise the plan
  is dropped and the user is told to preview again.
- **Short-lived.** A plan is dropped when its preview is cancelled (`discard_plan`), ten
  minutes after it was built, when its project's roots change, and when the app closes.
- An id that is already in the map is never replaced; a new plan gets a new id.

**Who owns confirmation.** The frontend does. An id exists from the moment the preview
opens, so the backend can't tell a click on the confirm button from any other call. What
the backend guarantees is that a plan is applied once, unchanged, for the project it was
built for, and only if the library still gives the same plan (see "Flow", step 3). A test
checks that the confirm button is the only caller of `apply_plan`.

### The writer lock

Apply, rollback and recovery all take one lock, and nothing else writes to a library.

- Inside the app it is a mutex. Across copies of Romio it is an exclusive OS lock on a file
  in the app data folder (`File::try_lock`, which needs Rust 1.89; the manifest says 1.75),
  held for the length of the operation. Romio has no single-instance guard today, so two
  copies can run.
- It is one lock for the whole app, not one per project: two projects can share a root.
- A call that finds the lock taken is refused with "Romio is already writing", not queued.
  Recovery that finds it taken does nothing; the copy holding it is still working.
- Editing a project's library roots, and deleting a project, are refused while the lock is held.

Scans don't take the lock and don't wait for it. A scan that runs during a write can see a
temporary file or half a plan applied. That is accepted: a scan's report never authorises a
write, because every planner reads the disk itself and every apply builds its plan again.

## Flow

```text
plan_*(project_id, input)          -> ChangePlan     (reads only; stored as pending)
  UI: ChangePreview modal lists every operation: full path and the file's contents.
  One primary button: "Write N files". Cancel discards.
apply_plan(plan_id, project_id)    -> ApplyResult
  1. claim:    take the plan out of the pending map; check project and roots
  2. lock:     take the writer lock, or refuse
  3. replan:   build the plan again from `input`. If its operations differ from the ones
               shown, refuse: "the library changed, preview again". Nothing is written.
  4. confine:  every path, and every `requires` path, is inside a library root (below)
  5. journal:  insert the row, status "applying", every op "pending". Commit. If this
               fails, stop: nothing has been written.
  6. per op:   the steps under "One operation, step by step"
  7. on failure: undo completed ops in reverse (the rollback steps); status "failed"
  8. status "applied"
rollback_operation(log_id)         -> RollbackResult
  take the writer lock; the row's recorded roots must still be roots of its project;
  reverse each "done" op, last first, by the rollback steps
```

`apply_plan` and `rollback_operation` run in `spawn_blocking`.

Steps 1 to 4 can fail without a trace, because nothing has been written. From step 5 on,
every failure leaves a journal row that says how far it got.

## Confinement

Checked for the whole plan before the journal row, and again for each operation right
before it runs. The same check covers `requires` paths, temporary files, and every path
recovery or rollback touches.

- **The root first.** Each configured root is inspected as written, before anything
  resolves it: it must be an existing folder and not itself a symlink, junction or other
  reparse point. A root that is a link is refused with a message that says why.
- **Containment is the filesystem's answer, not a string comparison.** Romio opens the
  path's parent folder and walks up its ancestors, and one of them must be the same folder
  as a root: same volume and same file id, read from both while both are open. This is
  right on case-sensitive and case-insensitive volumes alike, for Unicode-equivalent
  spellings, 8.3 short names, and drive-letter, UNC and `\\?\` forms of the same path, because
  none of them are compared as text. Where the two can't be compared this way, the plan is refused.
- A path with a `..` component is refused outright, not resolved.
- No folder between the root and the file may be a symlink, a junction or any other
  reparse point, and the file itself may not be one. Libraries built on symlinks are
  refused in version 1 with a message that says why.
- The file name must be valid on Windows as well: no reserved names, no trailing dot or space.

What this leaves open is stated under "What this protects against".

## Ownership

Romio may delete a file only if it can prove the file is the one it wrote. The proof is two
things recorded in the journal while the file was still Romio's private temporary file:

- its **file identity**: volume and file index on Windows, device and inode elsewhere. A
  rename within a folder keeps it, so the published file carries the temporary file's identity;
- the **SHA-256** of its contents.

A file is Romio's when both match. Contents alone are not proof: a frontend can write a
byte-identical playlist of its own.

**Where identity can be trusted.** Only on filesystems on an allow-list, starting with
NTFS, ReFS, APFS, ext4, Btrfs and XFS. FAT and exFAT ids can change on rename; network
shares vary. Everything not on the list is treated as having no identity, whatever the
system call returns. On such a drive:

- Romio still writes the file. The preview says first: "Romio can't undo this on this drive.
  To undo it, delete the files yourself."
- The journal entry has no Roll back button and lists the files written.
- Recovery never removes or claims anything there. It reports what it found.

Exactly which filesystems belong on the list, and how exFAT and common network shares
behave, is not verified yet. The list starts short for that reason.

## One operation, step by step

`CreateFile`, with what is durable after each step. "Recorded" means the op's state is
written to the journal row and committed before the next step starts.

| Step | What happens | Recorded state |
|---|---|---|
| 1 | Confine and recheck: nothing exists at `path`, the parent folder exists, every `requires` path is a regular file | |
| 2 | Choose the temporary name: `.romio-<uuid>.tmp` in the same folder | `started`, with the name |
| 3 | Create the temporary file with create-new (fails if anything is there), write the contents in full, sync the file | |
| 4 | Read the temporary file's identity and hash | `written`, with both |
| 5 | Recheck step 1, then publish: move the temporary file to `path` with a no-replace rename, then sync the folder where the platform can | |
| 6 | | `done` |

Any step that fails, including a sync or a journal commit that fails or can't be confirmed,
fails the operation. Romio removes its temporary file (under the recovery rule for the
state reached, below) and the plan goes to "on failure".

**No-replace rename.** `std::fs::rename` replaces an existing file on every platform, so it
isn't used. Windows: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`. Linux:
`renameat2` with `RENAME_NOREPLACE`. macOS: `renamex_np` with `RENAME_EXCL`. Where the
filesystem doesn't support the call, the operation is refused with "this drive can't do a
safe rename". There is no check-then-rename fallback: that is the race this rule exists to close.

The temporary file is in the destination folder, so the rename never crosses volumes.

## The journal

Migration `005_operation_journal.sql` adds to `operation_log`:

- `status`: `applying`, `applied`, `failed`, `rolling_back`, `rolled_back`, `partly_rolled_back`
- `record_json`: a versioned record

```json
{ "version": 1,
  "plan": { ... the ChangePlan ... },
  "ops": [ { "state": "...", "temp_path": "...", "file_id": "... or null",
             "sha256": "...", "note": "what was found, or why it failed" } ] }
```

**Op states**

| State | Means | Reached from |
|---|---|---|
| `pending` | not started | |
| `started` | the temporary name is chosen; the file may exist, in part or whole | `pending` |
| `written` | the temporary file is complete and its identity and hash are recorded | `started` |
| `done` | published at `path` | `written`, or `undoing` at recovery |
| `undoing` | Romio has decided to remove the file | `done` |
| `undone` | removed, or found already gone | `undoing` |
| `skipped` | never produced a file; nothing to reverse | `pending`, `started`, `written` |
| `kept` | the file is there but no longer provably Romio's; left alone | `undoing` |
| `unknown` | recovery couldn't tell what happened; left alone | `started`, `written`, `undoing` |

`skipped`, `undone`, `kept` and `unknown` are final for recovery. A later rollback tries
`done` ops only. `kept` and `unknown` are never retried automatically: the entry shows the
path and what was found, and the user decides.

**Durability.** The database connection sets `journal_mode = WAL` and `synchronous = FULL`
explicitly; today it sets neither. Each state change is its own committed transaction. A
`done` therefore never exists without its `written` before it, and a `written` never
without the file having been synced.

The other direction can't be made airtight everywhere: Romio has no dependable way to
sync a folder on Windows, so after a power loss a `done` can outlive the rename it recorded. That case is
safe by construction. Every later step looks at the disk before it acts, and a `done` file
that isn't there is recorded as `undone` with the note "already gone".

- A record whose `version` this build doesn't know is shown read-only, with no rollback
  control, and recovery doesn't touch it.
- Entries without a record (existing checkpoints) are not reversible and show no rollback control.
- If the row's final status can't be saved, the row keeps its in-progress status and
  recovery sets it at the next start. The status follows from the op states. A row left
  in `applying` becomes `applied` when every op is `done`, and `failed` otherwise. A row
  left in `rolling_back` becomes `rolled_back` when no op is `done`, `kept` or `unknown`,
  and `partly_rolled_back` otherwise.

### Recovery at start

Recovery takes the writer lock, then handles every row of a known version whose status is
`applying` or `rolling_back`, or that has an op in `started`, `written` or `undoing`. For
each op, by state:

| State | Recovery does | Becomes |
|---|---|---|
| `pending` | nothing | `skipped` |
| `started` | if a regular file is at `temp_path` and its bytes are the start of the planned contents, it is Romio's half-written file: remove it. If nothing is there, nothing to do. | `skipped` |
| | anything else at `temp_path` | `unknown` |
| `written` | if the file at `temp_path` has the recorded identity and hash, it was never published: remove it | `skipped` |
| | else if the file at `path` has the recorded identity and hash, it was published | `done` |
| | else if neither path holds anything | `skipped` |
| | anything else | `unknown` |
| `undoing` | if the file at `path` has the recorded identity and hash, the removal never happened | `done` |
| | if nothing is at `path` | `undone` |
| | anything else | `unknown` |
| `done`, and every final state | nothing | unchanged |

- On a drive without trusted identity, "has the recorded identity and hash" is never true,
  so recovery removes nothing there and marks what it finds `unknown`. The one exception is
  the `started` rule, which rests on the file's own bytes and its random name.
- Every row above reads the disk and then writes one state. Run twice, or interrupted and
  run again, it reaches the same answer, because a removed file is simply "nothing there"
  the second time.
- Afterwards the row's status is set from its op states. An interrupted apply becomes
  `failed` and is listed in Rollback History as interrupted, with each operation's state.
  The user can roll back what is `done`. Nothing is reapplied automatically.

## Rollback

The same steps undo a plan that failed halfway and roll back one the user chose to. For
each `done` op, last first:

| Step | What happens | Recorded state |
|---|---|---|
| 1 | Confine `path` | |
| 2 | | `undoing` |
| 3 | If nothing is at `path`: nothing to do | `undone`, "already gone" |
| 4 | If the file at `path` has the recorded identity and hash: remove it, sync the folder where the platform can | `undone` |
| 5 | Otherwise leave it | `kept`, "changed or replaced since Romio wrote it" |

- An op that never reached `done` needs no reversal and is not touched.
- If saving an outcome fails, rollback stops. The op is left in `undoing`, which recovery
  settles from the disk at the next start.
- The entry is `rolled_back` when no op is left `done`, `kept` or `unknown`, and
  `partly_rolled_back` otherwise.
- The row's recorded roots must still be roots of its project. If they aren't, rollback is
  refused and the entry says which root is missing.

**Deleting a project.** Romio can't delete a project today. `operation_log` rows are deleted
with their project (`ON DELETE CASCADE`), so when deletion is built it must be refused while
any of the project's rows is `applying` or `rolling_back`, and its confirmation must say
that the project's rollback history goes with it and list entries that still have files on disk.

## Screens

- **Change Preview** is the shared `ChangePreview` modal, opened by each feature. It is not
  a sidebar screen: a plan only exists while its feature is open. The `preview` screen id is removed.
- **Rollback History** is a sidebar screen: the project's operation log, newest first, each
  entry with its summary, time, status, the files touched, and a Roll back button where
  reversible. Interrupted and partly rolled back entries are marked and stay at the top
  until resolved, with the path and note of every `kept` and `unknown` file. Rolling back
  opens the same modal, showing what will be removed.

## First feature: M3U playlists

- From the Multi-Disc screen, each set with no playlist gets a checkbox. Nothing is
  selected by default (PRD: never group without explicit confirmation).
- `plan_m3u(project_id, picks)` takes a folder and set name per pick and detects the set
  again from disk. It creates one `CreateFile` per set: `<set name>.m3u` beside the discs,
  one disc per line in disc order, file names only (relative, so the library can move),
  `\n` line endings, UTF-8 without a byte-order mark. Each disc, each sheet, and each track
  file a sheet names, goes in `requires`.
- A set can't be selected when:
  - its discs have missing track files, or a sheet that couldn't be checked;
  - a playlist for it exists in any state and under any name, including one named after the
    set that is unreadable or lists nothing real. Those are the user's files; Romio reports them only;
  - a disc's file name starts or ends with whitespace, starts with `#` once whitespace is
    trimmed (readers trim a line, then treat `#` as a comment), contains a line break or
    control character, or isn't valid UTF-8;
  - its playlist name would collide with another pick's or with an existing file.
- **Round trip.** The planner feeds the contents it is about to write back through Romio's
  own playlist reader, with the set's discs. The result must be a complete playlist with no
  problems. If it isn't, the set can't be selected. This keeps the writer and the reader
  from disagreeing about what a line means.
- The planner checks collisions across the whole plan, not per set. Its check is for the
  preview. What actually prevents a collision is the no-replace rename, which asks the
  filesystem and so is right on case-sensitive and case-insensitive volumes alike.
- **At apply**, step 3 builds the plan again. A sheet that now names different tracks, a
  disc that was added or removed, or a competing playlist that appeared under any name
  changes the operations, and the apply is refused before anything is written.
- After writing, the screen rescans.

## Testing

- Scenario tests on fake libraries:
  - apply then rollback leaves the folder byte-identical;
  - a target that appears before apply blocks the whole plan, and one that appears between
    the recheck and the publish fails that operation without replacing anything;
  - a failure on the second op undoes the first;
  - a created file edited afterwards, or replaced by a different file with the same bytes,
    is kept by rollback;
  - a path outside the library root, through `..`, a symlink or a junction, a root that is
    itself a link, or a sibling folder whose name starts with the root's, is refused; a
    path given in another letter case or as a `\\?\` path to the same folder is accepted;
  - the same plan id applied twice, or from two threads at once, writes once;
  - a plan whose project's roots changed is refused;
  - a library that changed after the preview (a sheet edited, a disc removed, a playlist
    added under another name) is refused at step 3;
  - a second apply while the writer lock is held, in the same process and from a second
    process, is refused; recovery in a second process does nothing;
  - a playlist the planner emits reads back as complete, and a disc named with leading
    whitespace before `#` can't be selected;
  - with identity reported as untrusted, the entry has no rollback and recovery removes nothing.
- **Failure injection.** The file and journal steps go through one seam that a test can
  fail or stop at. For every step of "One operation" and of rollback: stop there, run
  recovery, and check each op's state and the folder. Then stop recovery itself at each
  write and run it again; the result must be the same. This covers every row of the
  recovery table, including a foreign file at the temporary or final path, and a row with an
  unknown `version`, which must come out untouched.
- Not testable in CI: a real power loss, a filesystem without no-replace rename, and real
  FAT, exFAT and network drives. The refusal path and the untrusted-identity path get unit
  tests with the calls stubbed. Killing the process tests restart logic, not durability.
- Codex reviews this spec, then each PR. Gemini checks each write feature on the desktop
  against a throwaway copy of a library, including killing the app mid-apply and writing to
  an exFAT drive.

## Decisions on the earlier open questions

Decided by the owner on 2026-11-12, following Codex's recommendations.

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
  its input. Not taken: binding operations to open folder handles.
- Codex on `eae265b`: recovery could claim a file Romio never wrote; an interrupted undo
  had no defined resume; no durability or ordering was required; containment compared text
  and promised more than the threat model; the fingerprint fallback could authorise the
  wrong rollback; a second process could race recovery, and deleting a project would erase
  its journal; temporary files and playlist revalidation were underspecified. Taken as:
  ownership proved by identity and hash recorded before publishing, a state table with one
  recovery action per state, explicit SQLite durability, containment by folder identity, no
  rollback where identity can't be trusted, one app-wide writer lock, and replanning at
  apply. `Rename` is deferred to the format-fix spec, not fixed here. Still not taken:
  folder handles; the residual risk is now stated in the rules as well as the threat model.
