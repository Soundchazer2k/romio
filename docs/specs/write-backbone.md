# Write Backbone — Design Spec

**Status:** Draft, revised after four Codex reviews (`a450cdb`, `eae265b`, `8c3927b`, `5aff901`). No code yet.
**Scope:** The one path every write to a user's library goes through, plus the first feature
on it (M3U playlists). Version 1 only creates new files. It has no rollback; see "Why
version 1 has no rollback".

## Problem

Romio writes nothing to a library today. Six features need to (roadmap phase 2). If each
writes on its own, each gets its own preview and its own failure handling, and one of them
will get it wrong on someone's only copy of a game. The PRD's rules are: preview before
every write, a log of every operation, and rollback of anything reversible.

## What this protects against

The library changing under Romio by accident: the user, a frontend, a scraper or a sync
tool touching files between the preview and the write, or the app or machine stopping
halfway. It does not try to defend against a hostile program already running as the user.
That program can edit the library directly.

One limit follows, and the rules below don't promise past it. **Romio checks a path and
then acts on that path.** A folder that is moved or swapped for a link in the moment
between the two can send the write somewhere else. Closing that needs every operation
anchored to an open, validated folder handle, which the standard library doesn't offer
portably. Version 1 doesn't do it. An ordinary user or sync tool can trigger this, not only
a hostile one; the window is the few milliseconds between a check and its call.

## Why version 1 has no rollback

Three reviews in a row found new ways for rollback to delete the wrong file or for crash
recovery to lose track of one. They all came from the same place: to delete a file after a
restart, Romio has to prove the file is still the one it wrote, and that proof depends on
filesystem behaviour (stable file ids, creation times that survive a rename, ids that
aren't reused) that hasn't been tested on any filesystem yet. Until one is, rollback would
have been switched off everywhere anyway.

So version 1 drops it, and with it every rule that existed to make deletion safe:

- Romio never removes, changes or moves a file that is in the library.
- A plan that stops halfway is not undone. What was written stays, and is listed.
- After a crash Romio reports what it finds. It repairs nothing.

This is safe only because version 1 creates new files and touches nothing that exists. A
new playlist that turns out to be unwanted is deleted by hand, and nothing else is lost.
**No operation that changes, moves or removes an existing file may be added until a
rollback spec is merged.** That covers the renames format fixes need and everything save
migration needs. The PRD's "rollback of anything reversible" is deferred to that spec, not
dropped.

## Rules

1. A write happens only by applying a **change plan**, once. The frontend shows the plan
   and asks for confirmation; the backend enforces the rest.
2. Romio never overwrites a file, and never removes, changes or moves a file in the
   library. The one thing it may remove is its own temporary file, while it still holds
   the handle it created that file with.
3. Every path a plan touches is checked to be inside the project's library roots, when the
   plan is applied and again before each operation. The check is by path, with the limit
   stated above.
4. Each operation is checked against the disk again immediately before it runs, and
   publishes its file with a primitive that refuses to replace an existing one.
5. What Romio is about to do is durably in the journal before it does it.
6. A plan that fails halfway stops. Nothing already written is undone, and the history
   says exactly what was and wasn't written.
7. Where Romio can't tell what happened, it says so and leaves the files alone.
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

- Version 1 has one operation. Each `CreateFile` stands alone: no operation depends on
  another having succeeded, which is what makes "stop, don't undo" safe.
- Plans are built by pure engine functions (`engine::multidisc::plan_m3u`, ...) that read
  the disk and write nothing. A planner takes what the user picked (`input`) and reads the
  files itself. It never trusts file lists sent from the webview.
- A planner is deterministic: the same `input` on an unchanged library gives the same
  operations in the same order. Two plans are equal when their ordered operations are
  equal; `id` and `created_at` don't count.

### Pending plans

The backend keeps pending plans in memory, keyed by id. The frontend gets the plan to show
and sends back only its id and project id.

- **One use.** `apply_plan` removes the plan from the map before doing anything else, under
  the map's lock. A second call with the same id, at the same time or later, finds nothing
  and is refused.
- **Bound to its project.** The id must belong to the project id sent with it, the project
  must still exist, and its library roots must equal the plan's `roots`. This is checked
  under the writer lock, so a root edit can't slip in after it. Otherwise the plan is
  dropped and the user is told to preview again.
- **Short-lived.** A plan is dropped when its preview is cancelled (`discard_plan`), ten
  minutes after it was built, when its project's roots change, and when the app closes.
- An id that is already in the map is never replaced; a new plan gets a new id.

**Who owns confirmation.** The frontend does. An id exists from the moment the preview
opens, so the backend can't tell a click on the confirm button from any other call. What
the backend guarantees is that a plan is applied once, unchanged, for the project it was
built for, and only if the library still gives the same plan (see "Flow", step 3). A test
checks that the confirm button is the only caller of `apply_plan`.

### The writer lock

Applying a plan and settling the journal both take one lock, and nothing else writes to a library.

- Inside the app it is a mutex. Across copies of Romio it is an exclusive OS lock on one
  fixed file in the app data folder (`File::try_lock`, which needs Rust 1.89; the manifest
  says 1.75). Romio has no single-instance guard today, so two copies can run.
- It is one lock for the whole app, not one per project: two projects can share a root.
- **Held for the whole of it.** The lock is taken before the plan's project and roots are
  checked and released only after the row's final status is saved. It is never dropped
  between two operations.
- **Settle before writing.** Whoever takes the lock first settles every row still marked
  `applying` (see "After a crash"), and only then starts its own work. A copy of Romio
  that started while another was writing skipped this at its own start; if the writer
  then crashed, this is where its row gets settled.
- **The gate.** If a row marked `applying` can't be read, can't be understood (its
  `version` is one this build doesn't know), or its settling can't be committed, nothing
  new is written. The call is refused with the reason: "an earlier write didn't finish and
  Romio can't read its record", or "a newer version of Romio left a write unfinished; open
  that version once to finish it".
- A call that finds the lock taken is refused with "Romio is already writing", not queued.
  Settling at start that finds it taken does nothing; the copy holding it is still working.
- Editing a project's library roots, and deleting a project, take the same lock and pass
  the same gate, so they can't interleave with a write or strand an unfinished row.
- **Fail closed.** If the lock file can't be created or locked for any reason other than
  being held, nothing is written. The guarantee covers copies of Romio that share one
  local app data folder. An app data folder on a network share, where file locks vary, is
  not supported for writing until it is tested.

Scans don't take the lock and don't wait for it. A scan that runs during a write can see a
temporary file or half a plan applied. That is accepted: a scan's report never authorises a
write, because every planner reads the disk itself and every apply builds its plan again.

## Flow

```text
plan_*(project_id, input)          -> ChangePlan     (reads only; stored as pending)
  UI: ChangePreview modal lists every operation: full path and the file's contents.
  It says Romio can't undo this. One primary button: "Write N files". Cancel discards.
apply_plan(plan_id, project_id)    -> ApplyResult
  1. claim:    take the plan out of the pending map
  2. lock:     take the writer lock, or refuse. Held until the end of step 8.
               Settle rows marked "applying" and pass the gate. Then check project and roots.
  3. replan:   build the plan again from `input`. If it isn't equal to the one shown,
               refuse: "the library changed, preview again". Nothing is written.
  4. confine:  every path, and every `requires` path, is inside a library root (below)
  5. journal:  insert the row, status "applying", every op "pending". Commit. If this
               fails, stop: nothing has been written.
  6. per op:   the steps under "One operation, step by step"
  7. on the first op that fails: stop. Ops not yet started become "skipped".
  8. save the row's final status with the last op state, in one transaction; release the lock
```

`apply_plan` runs in `spawn_blocking`.

Steps 1 to 4 can fail without a trace, because nothing has been written. From step 5 on,
every failure leaves a journal row that says how far it got.

An equal replan runs on the original preview; the user isn't asked again. The library can
still change between step 3 and an operation's own recheck, which looks only at whether
files exist and are regular files. That gap is part of the window stated under "What this
protects against".

## Confinement

Checked for the whole plan before the journal row, and again for each operation right
before it runs. The same check covers `requires` paths and temporary files.

- **The root first.** Each configured root is inspected as written, before anything
  resolves it: it must be an existing folder and not itself a symlink, junction or other
  reparse point. A root that is a link is refused with a message that says why.
- **Containment is the filesystem's answer, not a string comparison.** Romio opens the
  path's parent folder and walks up its ancestors, and one of them must be the same folder
  as a root: same volume and same file id, read from both while both are open. This is
  right on case-sensitive and case-insensitive volumes alike, for Unicode-equivalent
  spellings, 8.3 short names, and drive-letter, UNC and `\\?\` forms of the same path, because
  none of them are compared as text. Two folders that are open at the same moment can be
  matched this way even on a filesystem whose ids don't last.
- Where the two can't be compared this way, the plan is refused: a mapped or `subst` drive,
  a mount point or a share whose folders give no comparable id is a reason to refuse, not
  to fall back to text.
- A path with a `..` component is refused outright, not resolved.
- No folder between the root and the file may be a symlink, a junction or any other
  reparse point, and the file itself may not be one. Libraries built on symlinks are
  refused in version 1 with a message that says why.
- The file name must be valid on Windows as well: no reserved names, no trailing dot or space.

What this leaves open is stated under "What this protects against".

## One operation, step by step

`CreateFile`. "Recorded" means the op's state is written to the journal row and committed
before the next step starts.

| Step | What happens | Recorded state |
|---|---|---|
| 1 | Confine and recheck: nothing exists at `path`, the parent folder exists, every `requires` path is a regular file | |
| 2 | Choose the temporary name: `.romio-<uuid>.tmp` in the same folder | `started`, with the name |
| 3 | Create the temporary file with create-new (fails if anything is there), write the contents in full, sync the file. Keep the handle open. | |
| 4 | Recheck step 1. Check that the temporary path still names the file the open handle refers to: same volume and file id, read from the handle and from the path. | |
| 5 | Publish: move the temporary file to `path` with a no-replace rename, then sync the folder where the platform can. Close the handle. | |
| 6 | | `done` |

The check in step 4 is a live one, like confinement: it compares two things that are open
at the same moment, so it needs nothing from the filesystem that has to last. If the two
can't be compared on this drive, the operation is refused before anything is published.

**When a step fails.** A failed sync of the temporary file counts as a failed step. So does a journal commit that
fails or can't be confirmed: Romio reads the row back, and what the database holds is the state.

| Where | What Romio does | Recorded state |
|---|---|---|
| Step 1 | nothing | `failed`, with the reason |
| Step 3, create-new fails | nothing. Something else is at that name; Romio didn't create it and doesn't touch it. | `failed` |
| Steps 3 to 5, before the rename succeeded | removes its temporary file (below) | `failed`; the note names the temporary file if it had to be left |
| Step 5, the rename succeeded but the folder sync failed | nothing. The file is at `path`. | `done`, with the note "couldn't confirm it is saved to disk" |
| Step 6, the commit fails | stops the plan. The row stays `applying` and is settled at the next start. | whatever the database holds |

**Removing the temporary file.** This is the only removal Romio ever does, and only in the
process that created the file, while the creating handle is still open:

- Windows: the file is deleted through that handle.
- Elsewhere a file can only be unlinked by name, so Romio first checks that the name still
  refers to the open handle's file (the step 4 check), then unlinks it. The moment between
  the two is the same path window as everywhere else.
- If the check fails or the removal fails, the file is left and the entry names it.

After a restart there is no open handle, so nothing is removed, whatever its name.

**No-replace rename.** `std::fs::rename` replaces an existing file on every platform, so it
isn't used. Windows: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`. Linux:
`renameat2` with `RENAME_NOREPLACE`. macOS: `renamex_np` with `RENAME_EXCL`. Where the
filesystem doesn't support the call, the operation is refused with "this drive can't do a
safe rename". There is no check-then-rename fallback: that is the race this rule exists to close.

The temporary file is in the destination folder, so the rename never crosses volumes.

## The journal

Migration `005_operation_journal.sql` adds to `operation_log`:

- `status`: `applying`, `applied`, `incomplete`
- `record_json`: a versioned record

```json
{ "version": 1,
  "plan": { ... the ChangePlan ... },
  "ops": [ { "state": "...", "temp_path": "...", "note": "why it failed, or what was found" } ] }
```

**Op states**

| State | Means | Set by |
|---|---|---|
| `pending` | not started | the journal row |
| `started` | the temporary name is chosen; from here until `done` a file may exist at the temporary name or at `path` | step 2 |
| `done` | the file was published at `path` | step 6, or a failed folder sync |
| `failed` | Romio knows it published nothing at `path` | a failed step |
| `skipped` | never started, because an earlier op failed or the app stopped | step 7, or settling |
| `unknown` | the app stopped mid-operation; Romio doesn't know whether the file was published | settling |

Every state except `pending` and `started` is final. Nothing moves an op out of a final state.

**The row's status, one rule.** `applied` when every op is `done`; `incomplete` otherwise.
It is computed from the op states alone and saved in the same transaction as the last op
state it depends on. No status depends on what the row was doing before.

**Durability.** The database connection sets `journal_mode = WAL` and `synchronous = FULL`
explicitly; today it sets neither. Each state change is its own committed transaction. The
row exists before the first file is touched, and an op is `started` before its temporary
file exists.

The journal says what Romio did, not what is on the disk now. Changes to a folder can't be
made durable everywhere (Romio has no dependable way to sync a folder on Windows), so
after a power loss a `done` file can be missing. And a user can delete a playlist at any
time. The history screen therefore looks at the disk each time it is shown, and says for
each file whether it is there now. Nothing in the journal is changed by that look.

- A record whose `version` this build doesn't know is shown read-only.
- Entries without a record (existing checkpoints) are shown as they are today.

### After a crash

A row still marked `applying` was interrupted. Settling it is one transaction that writes
every op's final state and the row's status together:

| Op state | Becomes |
|---|---|
| `pending` | `skipped` |
| `started` | `unknown`. The note records what is at `path` and at the temporary name right now: a file, nothing, or "couldn't look", with the error. |
| `done`, `failed`, `skipped` | unchanged |

- **When.** At start, under the writer lock. And again by whoever takes the writer lock,
  before it writes, subject to the gate.
- **It touches no file.** It doesn't remove a leftover temporary file, and it doesn't
  claim a file at `path` as Romio's. The note says what is there, and the entry names both
  paths, so the user can look and delete what they don't want.
- **Run twice.** The transaction either commits or it doesn't. If the app stops before the
  commit, the row is still `applying` and is settled again from the start; the only thing
  that can differ is the note, which describes the disk at the time.
- An interrupted row ends as `incomplete`. Nothing is reapplied automatically. The user
  runs the feature again, and its planner offers whatever is still missing.

## Screens

- **Change Preview** is the shared `ChangePreview` modal, opened by each feature. It is not
  a sidebar screen: a plan only exists while its feature is open. The `preview` screen id is
  removed. Above the confirm button it says: "Romio can't undo this. To undo it, delete the
  files listed here."
- **History** is a sidebar screen, in place of the planned Rollback History: the project's
  operation log, newest first. Each entry has its summary, time and status, and for each
  file its state, whether it is there now, and a "Show in folder" button. Incomplete entries
  are marked, with each `failed` and `unknown` note and any leftover temporary file named.
  It has no Roll back button. The `rollback` screen id is renamed `history`.

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
- **After a partial or interrupted apply**, the sets whose playlists were written now have
  one, so they can't be selected again; the rest still can. Running the feature again
  finishes the job.
- After writing, the screen rescans.

## Testing

- Scenario tests on fake libraries:
  - a plan applied in full writes exactly the planned files with the planned bytes, and
    leaves no temporary file;
  - a target that appears before apply blocks the whole plan, and one that appears between
    the recheck and the publish fails that operation without replacing anything, removes
    Romio's temporary file, and leaves the earlier playlists written and the later ones skipped;
  - a file already at the temporary name, empty or not, is never removed;
  - a temporary file swapped for another before the publish is not published and not removed;
  - a path outside the library root, through `..`, a symlink or a junction, a root that is
    itself a link, or a sibling folder whose name starts with the root's, is refused; a
    path given in another letter case or as a `\\?\` path to the same folder is accepted;
  - the same plan id applied twice, or from two threads at once, writes once;
  - a plan whose project's roots changed is refused;
  - a library that changed after the preview (a sheet edited, a disc removed, a playlist
    added under another name) is refused at step 3;
  - a second apply while the writer lock is held, in the same process and from a second
    process, is refused; a copy of Romio that outlives a crashed writer settles that
    writer's row before its own apply; a root edit during an apply is refused;
  - a row marked `applying` that can't be read, or has an unknown `version`, blocks the
    next write with the stated reason and is left untouched;
  - a playlist the planner emits reads back as complete, and a disc named with leading
    whitespace before `#` can't be selected;
  - after an interrupted apply, running the feature again offers only the missing playlists;
  - no test, in any outcome, finds a file in the library removed or changed other than
    Romio's own temporary file.
- **Failure injection.** The file and journal steps go through one seam that a test can
  fail or stop at. For every step of "One operation": fail there and check the op's state,
  the row's status and the folder against the failure table. Then stop the process there,
  settle, and check against the settling table. Then stop the settling before its commit
  and run it again; the states must be the same.
- Not testable in CI: a real power loss, and a filesystem without no-replace rename. The
  refusal path gets a unit test with the call stubbed. Killing the process tests restart
  logic, not durability.
- Codex reviews this spec, then each PR. Gemini checks each write feature on the desktop
  against a throwaway copy of a library, including killing the app mid-apply and writing to
  an exFAT drive.

## Left to the implementation PR

Details that can be settled in code review, not here:

- The live identity check and the handle-based removal on each platform, with a test for each.
- The same-volume rename and folder-sync call actually used on each platform.
- WAL's effect on the whole app database: the `-wal` and `-shm` files, checkpointing, and
  checking the effective mode before a write is allowed.
- `File::try_lock` against the manifest's Rust 1.75, and lock behaviour on a network home.
- Which root spellings (mapped drive, `subst`, UNC, mount point) can be compared by
  identity, and the refusal message where they can't.
- Playlists read by ES-DE, Batocera and RetroBat themselves. The round trip proves the
  planner agrees with Romio's reader, nothing more.

## For the rollback spec

Not part of version 1. Kept here so the work isn't repeated. Deleting or moving a file
after a restart needs durable proof that it is still the file Romio wrote. Codex's reviews
established that this proof:

- can't rest on a file's name or its contents: a frontend can write a byte-identical file;
- needs a file identity that survives a rename and a restart and is not handed to a
  replacement, which filesystems don't promise: ids are reused, NTFS can carry a creation
  time over to a new file of the same name, creation time is writable on macOS and absent
  on some Linux configurations, and FAT and exFAT ids can change on rename;
- has to be shown per filesystem by tests that force id reuse, not by one delete-and-recreate;
- needs a journal that records intent before each removal, derives a row's status from
  durable state alone, and rechecks both the final and the temporary name after a power loss.

## Decisions

Decided by the owner on 2026-11-12.

1. **Disc files still show as games.** Version 1 writes the playlist only and keeps the
   discs visible. Batocera and RetroBat already hide discs a playlist lists; ES-DE doesn't.
   Hiding comes later as an opt-in operation per frontend, after checking how that frontend
   indexes the layout, and never by editing a frontend's own files without its own spec.
2. **Plans don't survive a restart.** Unapplied plans are dropped. The journal does survive.
3. **Export** gets its own destination root, confirmed separately by the user, with the
   same confinement, collision and journal rules applied inside it. Its spec defines the confirmation.
4. **Version 1 has no rollback.** It creates files and never removes, changes or moves one.
   Rollback gets its own spec, which must be merged before any operation that touches an
   existing file.

## Review history

- Codex on `a450cdb`: confinement and preconditions could go stale before the write; the
  log was written after the files, so a crash left no record; rollback could move or delete
  a replaced file; a plan id proved lookup, not single use; the playlist planner trusted
  its input. Not taken: binding operations to open folder handles.
- Codex on `eae265b`: recovery could claim a file Romio never wrote; an interrupted undo
  had no defined resume; no durability or ordering was required; containment compared text
  and promised more than the threat model; the fingerprint fallback could authorise the
  wrong rollback; a second process could race recovery, and deleting a project would erase
  its journal; temporary files and playlist revalidation were underspecified. `Rename` was
  deferred here.
- Codex on `8c3927b`: a temporary file could be removed on its name and a content prefix;
  apply, undo and recovery disagreed on transitions; filesystem type alone didn't qualify a
  file id for deletion; a copy of Romio that outlived a crashed writer could write first.
- Codex on `5aff901`: settling could lose track of a file across a second crash or a
  reappearing temporary file; with no qualified filesystem the publish check could never
  pass; one recreate test couldn't qualify a filesystem; the recovery gate wasn't explicit.
  Every one of these lived in rollback and repair. The owner chose to remove both from
  version 1, which removes the findings with them. Kept from this round: the live check
  before publishing, a status derived from op states in one transaction, and the gate.
