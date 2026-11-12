# Write Backbone — Design Spec

**Status:** Draft, revised after Codex's reviews of `a450cdb`, `eae265b` and `8c3927b`. No code yet.
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

Apply, rollback and recovery all take one lock, and nothing else writes to a library.

- Inside the app it is a mutex. Across copies of Romio it is an exclusive OS lock on a file
  in the app data folder (`File::try_lock`, which needs Rust 1.89; the manifest says 1.75).
  Romio has no single-instance guard today, so two copies can run.
- It is one lock for the whole app, not one per project: two projects can share a root.
- **Held for the whole of it.** The lock is taken before the plan's project and roots are
  checked and released only after the row's final status is saved. That covers every
  operation of the plan, the undo of a failed plan, and a whole rollback or recovery.
  It is never dropped between two operations.
- **Recover before writing.** Whoever takes the lock first settles every unsettled journal
  row (see "Recovery"), and only then starts its own work. A copy of Romio that started
  while another was writing skipped recovery at its own start; if the writer then crashed,
  this is where its row gets settled, before anything new is written.
- A call that finds the lock taken is refused with "Romio is already writing", not queued.
  Recovery at start that finds it taken does nothing; the copy holding it is still working.
- Editing a project's library roots, and deleting a project, take the same lock, so they
  can't interleave with a write.
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
  One primary button: "Write N files". Cancel discards.
apply_plan(plan_id, project_id)    -> ApplyResult
  1. claim:    take the plan out of the pending map
  2. lock:     take the writer lock, or refuse. Held until the end of step 8.
               Settle any unsettled journal row first. Then check project and roots.
  3. replan:   build the plan again from `input`. If it isn't equal to the one shown,
               refuse: "the library changed, preview again". Nothing is written.
  4. confine:  every path, and every `requires` path, is inside a library root (below)
  5. journal:  insert the row, status "applying", every op "pending". Commit. If this
               fails, stop: nothing has been written.
  6. per op:   the steps under "One operation, step by step"
  7. on failure: settle the op that failed from the disk (the transition table), then
               undo every "done" op in reverse (the rollback steps)
  8. save the row's final status (one rule, under "The journal"); release the lock
rollback_operation(log_id)         -> RollbackResult
  take the writer lock and settle unsettled rows; the row's recorded roots must still be
  roots of its project; reverse each "done" op, last first, by the rollback steps; save
  the final status; release the lock
```

`apply_plan` and `rollback_operation` run in `spawn_blocking`.

Steps 1 to 4 can fail without a trace, because nothing has been written. From step 5 on,
every failure leaves a journal row that says how far it got.

An equal replan runs on the original preview; the user isn't asked again. The library can
still change between step 3 and an operation's own recheck, which looks only at whether
files exist and are regular files. That gap is part of the window stated under "What this
protects against".

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
  none of them are compared as text. Where the two can't be compared this way, the plan is
  refused: a mapped or `subst` drive, a mount point or a share whose folders give no
  comparable id is a reason to refuse, not to fall back to text.
- This needs less than "Ownership" does. Two folders that are open at the same moment can
  be told apart or matched even on a filesystem whose ids don't last, so a drive with no
  rollback can still be written to safely.
- A path with a `..` component is refused outright, not resolved.
- No folder between the root and the file may be a symlink, a junction or any other
  reparse point, and the file itself may not be one. Libraries built on symlinks are
  refused in version 1 with a message that says why.
- The file name must be valid on Windows as well: no reserved names, no trailing dot or space.

What this leaves open is stated under "What this protects against".

## Ownership

Romio may delete a file only if it can prove the file is the one it wrote. The proof is two
things recorded in the journal while the file was still Romio's private temporary file:

- its **file identity**, three parts together: the volume, the file's id on that volume,
  and the file's creation time. On Windows the id is the full 128-bit file id
  (`FILE_ID_INFO`), which ReFS needs. Elsewhere it is the device and inode, with the
  subvolume where the filesystem has them (Btrfs inodes are unique only within one). A
  rename within a folder keeps all three, so the published file carries the temporary
  file's identity. The creation time is there because filesystems reuse ids: a file
  deleted and written again can get the old id, but not the old creation time;
- the **SHA-256** of its contents.

A file is Romio's when both match. Contents alone are not proof: a frontend can write a
byte-identical playlist of its own. A file's name is not proof either, however random.

**Where identity can be trusted.** Only on a filesystem that has been qualified: a test,
recorded in the implementation PR, shows that there the identity survives a no-replace
rename within a folder and a restart, and that a file deleted and recreated gets a
different one. NTFS, ReFS, APFS, ext4, Btrfs and XFS are the candidates; none is on the
list until its test exists. FAT and exFAT ids can change on rename, and network shares
vary, so they stay off. Everything not on the list is treated as having no identity,
whatever the system call returns. On such a drive:

- Romio still writes the file. The preview says first: "Romio can't undo this on this drive.
  To undo it, delete the files yourself."
- The journal entry has no Roll back button and lists the files written.
- Recovery never removes or claims anything there. It reports what it found.

The list starts empty, so until a filesystem is qualified Romio writes everywhere without
rollback.

## One operation, step by step

`CreateFile`, with what is durable after each step. "Recorded" means the op's state is
written to the journal row and committed before the next step starts.

| Step | What happens | Recorded state |
|---|---|---|
| 1 | Confine and recheck: nothing exists at `path`, the parent folder exists, every `requires` path is a regular file | |
| 2 | Choose the temporary name: `.romio-<uuid>.tmp` in the same folder | `started`, with the name |
| 3 | Create the temporary file with create-new (fails if anything is there), write the contents in full, sync the file | |
| 4 | Read the temporary file's identity and hash from the handle that wrote it | `written`, with both |
| 5 | Recheck step 1. Check that the file at the temporary path still has the recorded identity and hash. Publish: move it to `path` with a no-replace rename, then sync the folder where the platform can | |
| 6 | | `done` |

**When a step fails.** A failed sync counts as a failed step. So does a journal commit that
fails or can't be confirmed: Romio reads the row back, and what the database holds is the
state.

- Step 3, create-new fails: something else is at that name. Romio did not create it and
  does not touch it. The op becomes `skipped`.
- Step 3, after create-new succeeded: Romio removes the file through the handle it just
  created it with, while that handle is still open. The op becomes `skipped`. If it can't,
  the file stays and the op becomes `unknown`.
- Steps 4 to 6: the op is settled by the transition table below, exactly as at a restart,
  before anything else is undone. A file that was published but never recorded as `done` is
  found there and becomes `done`, so the undo that follows removes it.

Then the plan goes to "on failure" in the flow.

**No-replace rename.** `std::fs::rename` replaces an existing file on every platform, so it
isn't used. Windows: `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`. Linux:
`renameat2` with `RENAME_NOREPLACE`. macOS: `renamex_np` with `RENAME_EXCL`. Where the
filesystem doesn't support the call, the operation is refused with "this drive can't do a
safe rename". There is no check-then-rename fallback: that is the race this rule exists to close.

The temporary file is in the destination folder, so the rename never crosses volumes.

## The journal

Migration `005_operation_journal.sql` adds to `operation_log`:

- `status`: `applying`, `applied`, `failed`, `rolling_back`, `rolled_back`, `partly_rolled_back`
- `settled`: 0 or 1; whether the row has been checked against the disk since it last changed
- `record_json`: a versioned record

```json
{ "version": 1,
  "plan": { ... the ChangePlan ... },
  "ops": [ { "state": "...", "temp_path": "...", "identity": "... or null",
             "sha256": "...", "note": "what was found, or why it failed" } ] }
```

**Op states**

| State | Means |
|---|---|
| `pending` | not started |
| `started` | the temporary name is chosen; a file may or may not exist there, and nothing proves whose it is |
| `written` | the temporary file is complete and its identity and hash are recorded |
| `done` | published at `path` |
| `undoing` | Romio has decided to remove the file |
| `undone` | removed, or found gone |
| `skipped` | never produced a file; nothing to reverse |
| `kept` | a file is at `path` but isn't provably Romio's; left alone |
| `unknown` | Romio can't tell what happened; whatever is there is left alone |

**Transitions.** This is the only table. Applying, undoing and recovery all move an op by it
and by nothing else. "Is Romio's" means the file has the recorded identity and hash, on a
drive whose identity is trusted; on any other drive it is never true.

| From | When | To |
|---|---|---|
| `pending` | step 2 of an operation | `started` |
| `pending` | settling | `skipped` |
| `started` | step 4 | `written` |
| `started` | create-new failed, or Romio removed its own file through its open handle | `skipped` |
| `started` | settling: nothing is at `temp_path` | `skipped` |
| `started` | settling: anything is at `temp_path`. It is left there. | `unknown` |
| `written` | step 6 | `done` |
| `written` | settling: the file at `temp_path` is Romio's. Remove it. | `skipped` |
| `written` | settling: the file at `path` is Romio's | `done` |
| `written` | settling: nothing at `temp_path` and nothing at `path` | `skipped` |
| `written` | settling: anything else | `unknown` |
| `done` | rollback step 2 | `undoing` |
| `done` | settling: nothing is at `path` | `undone`, "not on disk" |
| `done` | settling: the file at `path` is Romio's | `done` |
| `done` | settling: something else is at `path` | `kept` |
| `undoing` | nothing is at `path` | `undone` |
| `undoing` | the file at `path` is Romio's, during a rollback: remove it | `undone` |
| `undoing` | the file at `path` is Romio's, while settling: the removal never happened | `done` |
| `undoing` | something else is at `path` | `kept` |
| `undone`, `skipped` | settling: the file at `path` is Romio's. It came back. | `done`, "came back after a power loss" |
| `undone`, `skipped` | settling: anything else | unchanged |
| `kept`, `unknown` | settling | unchanged |

`kept` and `unknown` are never changed or retried automatically: the entry shows the path
and what was found, and the user decides. A later rollback tries `done` ops only.

**The row's status, one rule.** Whenever a row's status is saved, at the end of an apply, a
rollback or a settling, it is computed from the op states and from what the row was doing:

- it was `applying`: `applied` when every op is `done`, otherwise `failed`;
- it was `rolling_back`: `rolled_back` when no op is `done`, `kept` or `unknown`, otherwise
  `partly_rolled_back`;
- it was already final and settling moved an op: `applied` when every op is `done`;
  `rolled_back` when it was `rolled_back` and still no op is `done`, `kept` or `unknown`;
  `partly_rolled_back` when it had been rolled back and that no longer holds; otherwise `failed`.

**Durability.** The database connection sets `journal_mode = WAL` and `synchronous = FULL`
explicitly; today it sets neither. Each state change is its own committed transaction, and
clears the row's `settled` flag in the same transaction. A `done` therefore never exists
without its `written` before it, and a `written` never without the file having been synced.

Changes to a folder (a publish, a removal) can't be made as durable everywhere: Romio has
no dependable way to sync a folder on Windows. After a power loss the journal can be ahead
of the folder in either direction: a `done` whose file is gone, an `undone` or `skipped`
whose file is back. So no state is taken on trust across a restart. Every row that changed
is settled against the disk at the next start, which is what `settled` is for, and the
table has a row for each of those cases.

- A record whose `version` this build doesn't know is shown read-only, with no rollback
  control, and is never settled or touched.
- Entries without a record (existing checkpoints) are not reversible and show no rollback control.
- If a row's final status can't be saved, the row keeps its in-progress status and is
  settled at the next start, or by the next writer.

## Recovery

Settling a row means: for each op, look at the disk, apply the one matching "settling" line
of the transition table, save the state; then save the row's status by the rule above and
set `settled`.

- **When.** At start, under the writer lock, for every row of a known version whose
  `settled` flag is clear. And again by whoever takes the writer lock, before it writes.
  That second case covers a copy of Romio that outlived a crashed writer.
- **What it removes.** One thing only: a temporary file that is provably Romio's, in the
  `written` state. It never removes a file on the strength of its name or its contents, and
  never removes anything on a drive without trusted identity.
- **Run twice.** Every line reads the disk and then writes one state. Interrupted and run
  again, it reaches the same answer: a file it removed is "nothing there" the second time,
  and `settled` is set only after the last op is saved.
- An interrupted apply ends as `failed` unless every op turned out `done`. It is listed in
  Rollback History as interrupted, with each operation's state. The user can roll back
  what is `done`. Nothing is reapplied automatically.
- A leftover `.romio-*.tmp` file that Romio couldn't prove was its own stays where it is.
  The entry names it so the user can delete it.

## Rollback

The same steps undo a plan that failed halfway and roll back one the user chose to. For
each `done` op, last first:

| Step | What happens | Recorded state |
|---|---|---|
| 1 | Confine `path` | |
| 2 | | `undoing` |
| 3 | Look at `path` and apply the `undoing` line of the transition table: nothing there; Romio's file, which is removed, then the folder synced where the platform can; or something else, which is left | `undone` or `kept` |

- An op that never reached `done` needs no reversal and is not touched.
- If saving an outcome fails, rollback stops. The op is left in `undoing`, which settling
  resolves from the disk.
- The row's recorded roots must still be roots of its project. If they aren't, rollback is
  refused and the entry says which root is missing.

**Deleting a project.** Romio can't delete a project today. `operation_log` rows are deleted
with their project (`ON DELETE CASCADE`), so when deletion is built it takes the writer
lock, settles first, and is refused while any of the project's rows is `applying`,
`rolling_back` or unsettled. Its confirmation must say that the project's rollback history
goes with it, and list entries that still have files on disk.

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
  - with identity reported as untrusted, the entry has no rollback and recovery removes nothing;
  - a file already at the temporary name, empty or not, is never removed, in a normal
    failure or at a restart;
  - a file deleted and recreated with the same bytes at the same path is kept by rollback;
  - a copy of Romio that outlives a crashed writer settles that writer's row before its
    own apply; a root edit during an apply waits or is refused.
- **Failure injection.** The file and journal steps go through one seam that a test can
  fail or stop at. For every step of "One operation" and of rollback: stop there, run
  recovery, and check each op's state and the folder. Then stop recovery itself at each
  write and run it again; the result must be the same. Named cases: the publish succeeds
  and the `done` commit fails; the removal succeeds and the `undone` commit fails; a file
  reappears at the path of an `undone` op. This covers every row of the
  transition table, including a foreign file at the temporary or final path, and a row with an
  unknown `version`, which must come out untouched.
- Not testable in CI: a real power loss, a filesystem without no-replace rename, and real
  FAT, exFAT and network drives. The refusal path and the untrusted-identity path get unit
  tests with the calls stubbed. Killing the process tests restart logic, not durability.
- Codex reviews this spec, then each PR. Gemini checks each write feature on the desktop
  against a throwaway copy of a library, including killing the app mid-apply and writing to
  an exFAT drive.

## Left to the implementation PR

Details Codex's third review sorted as settleable in code review, not here:

- Qualifying each candidate filesystem for trusted identity, with the test recorded.
- The same-volume rename and folder-sync call actually used on each platform.
- WAL's effect on the whole app database: the `-wal` and `-shm` files, checkpointing, and
  checking the effective mode before a write is allowed.
- `File::try_lock` against the manifest's Rust 1.75, and lock behaviour on a network home.
- Which root spellings (mapped drive, `subst`, UNC, mount point) can be compared by
  identity, and the refusal message where they can't.
- Playlists read by ES-DE, Batocera and RetroBat themselves. The round trip proves the
  planner agrees with Romio's reader, nothing more.
- A future `Rename` keeps the versioned record but needs its own intent, identity and
  reverse states.

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
- Codex on `8c3927b`, "merge after fixes", four blockers: a temporary file could be
  removed on its name and a content prefix; apply, undo and recovery disagreed on
  transitions and on a row's final status, and trusted states that a power loss can
  reverse; filesystem type alone didn't qualify a file id for deletion; a copy of Romio
  that outlived a crashed writer could write before recovering it. Taken as: nothing is
  removed without identity, one transition table and one status rule used by all three
  paths, every changed row settled against the disk at the next start, identity that
  includes creation time on filesystems qualified by test, and one lock held for the whole
  plan with recovery before any new write.
