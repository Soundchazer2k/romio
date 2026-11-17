# Tool Adapters — Design Spec

**Status:** Draft. No code yet. Facts about Igir come from its own documentation (igir.io,
read 2026-11-16) and from a spike on the same day: Igir 5.8.1, the official Windows x64
executable, run against generated libraries. "What the spike found" has the results, and
what is still unchecked on macOS and Linux.
**Scope:** How Romio runs someone else's program against a user's library, and the first
adapter: Igir, auditing a library against DAT files. Copying a library out through Igir
(the Export Planner) is outlined, and gets its own spec.
**Platforms:** Version 1 runs tools on Windows only, decided by the owner on 2026-11-17.
See "macOS and Linux: not in version 1".
**Depends on:** the PRD amendment (`docs/prd/2026-11-13-toolkit-direction.md`) and the
write backbone (`docs/specs/write-backbone.md`), whose journal this uses.

## Problem

Romio checks a library. The rest of the job (verifying dumps, keeping one copy of each
game, converting, patching) is done well by established command-line tools. The PRD
amendment makes Romio their front panel: a form in place of flags, a preview, and output
in a new folder. This spec says how, without giving up what the write backbone promises.

## What Romio can and can't promise

The write backbone proves that Romio's own code never touches a file it didn't create.
An adapter runs a program Romio didn't write, so it can't prove that. It can promise this,
and nothing more:

1. Romio only ever asks a tool for operations that read the library.
2. Anything a tool writes goes to a folder that is not the project's library and not
   inside it. The library meant is the one being audited or copied; another project's
   roots are not checked.
3. The exact command is shown before it runs and recorded after. The one exception is the
   version check described under "Finding the tool", which is a fixed command and is not
   recorded.
4. Romio never passes text the user typed straight to a tool as an option.

If a tool has a bug that damages its input, Romio doesn't prevent it. The preview says so
in plain words the first time a tool is run: "Romio runs Igir for you. Igir is a separate
program; Romio chooses what to ask it, not how it behaves."

## Rules

1. **An allow-list of verbs, per adapter.** The adapter can only build commands from verbs
   on its list. Verbs that change or delete input or existing output are not on any list.
2. **Arguments come from a typed form.** Every option the adapter can emit is a field with
   a type (a path chosen with the folder picker, a region from a fixed list). The command
   is built from the form as a list of arguments. There is no free-text options field.
3. **No shell.** The tool is started directly, and nothing is interpreted by a shell.
   Arguments stay a list until the last step. Windows takes one command line for a new
   process, so one function in the runner turns the list into that line, with the quoting
   a Windows program's own start-up code undoes. The program's path is passed apart from
   the line and never read out of it. Only a real executable file is run: a `.cmd` or
   `.bat` file would be handed to `cmd.exe`, which is a shell with other quoting rules.
4. **Inputs are the project's library roots,** and only those.
5. **Output goes outside the library.** An output folder must not be one of the project's
   library roots, sit inside one, or contain one. Folders are told apart the way the write
   backbone does it, by identity (volume and file id) and never by the text of a path. The
   question is the opposite of the backbone's, though: it asks that a path is inside a
   root, and this rule asks that it is not. The folder may not exist yet, so the check
   starts at its nearest existing folder and walks up: none of those may be a root. Then it
   walks up from each root, and must not reach the output folder. It is made under the
   writer lock, right before the tool starts, and a run is refused where two folders can't
   be compared. The same check covers what Romio itself hands the tool: the report
   file, the cache file and the working folder. If Romio's data folder is inside one of the
   project's library roots (a root set to the user's home folder, say), the adapter refuses
   to run and says why, since the report and cache would land in the library.
6. **Known versions only.** The adapter reads the tool's version and refuses one it wasn't
   written for. Reading a tool's output breaks when its format changes.
7. **Show the command.** Before running, and in the journal afterwards, as it would be
   typed in a terminal on this system.
8. **One tool run at a time,** under the write backbone's writer lock, so a tool never
   runs while Romio itself is writing. The lock is held until the tool's processes are
   gone, not until Stop is pressed. A run left over from a crash also counts, and it
   blocks Romio's own writes as well as tool runs: see "After a crash".
9. **Romio installs nothing.** Version 1 finds a copy the user installed. It never
   downloads a tool and never runs one through a package runner that downloads code
   (`npx`, `bunx`).
10. **Windows only in version 1.** A tool is run only where Romio can be sure the tool
    ends when Romio does. Today that is Windows. On macOS and Linux the adapter refuses to
    run and says so.

## The adapter contract

An adapter is a Rust module in `engine/adapters/`, pure where it can be:

```rust
pub trait ToolAdapter {
    /// "igir"
    fn id(&self) -> &'static str;
    /// Read the version from the tool at `path`. Err if this isn't the tool.
    fn probe(&self, path: &Path) -> Result<ToolVersion>;
    /// Whether this adapter was written for that version.
    fn supports(&self, version: &ToolVersion) -> bool;
}
```

Each action an adapter offers (for Igir: audit) is a pair of pure functions and one
runner call:

- `build(form) -> Vec<OsString>`: the argument list. Pure, and where rules 1, 2 and 4 are
  enforced and tested.
- `parse(output) -> Report`: turns what the tool produced into Romio's own model. Pure.
- the shared runner, which starts the process, streams progress, ends it on Stop and
  records the run.

There is no plugin system and no adapter loaded at run time. The trait exists so that the
second adapter has a shape to follow; it is revised when that adapter is written.

## Finding the tool

- **The user picks the file.** That is the first thing the screen offers. Romio also looks
  on `PATH`, but only to suggest: it shows the full path of what it found and runs nothing
  until the user accepts that path. A program with the tool's name that sits earlier on
  `PATH` than the real one would otherwise be run as the user, unseen.
- The accepted path is stored in app settings as an absolute path, not in a project: the
  tool belongs to the machine. Romio never looks the name up again at run time. It stores
  the file's size and modified time with the path, and asks again if either has changed.
- Romio does not verify who built the file. It has no list of good builds to compare with,
  and a copy installed by a package manager differs from the official download. The
  protection is that the user chose the path and can see it.
- `probe` runs the tool and reads its version. A file that doesn't answer like the tool is
  refused. Igir has no version flag: `--version` is an error. `igir --help` exits 0 and
  prints a banner holding `v5.8.1 (Bun v1.4.4)`, which is what `probe` reads.
- **The version check is the one command that is not journalled.** It runs when the user
  accepts a path, and again when the stored file has changed. The journal is per project
  and the check belongs to none. It is a fixed command (`<tool> --help` for Igir), is given
  no library path, and runs in an empty folder in Romio's data folder. It goes through
  `spawn_tracked`, the runner's lower layer, which needs no project, no version and no
  journal row. It takes no writer lock and may run beside anything else, a tool run or
  another check included: it is handed nothing to read or write, so there is nothing to
  keep it apart from. It has a job object of its own, like any run, so it ends with
  Romio. After ten seconds it is ended as Stop ends a run, and the path is refused. The screen shows the command beside the path before the
  user accepts.
- If nothing is found, the screen links to the tool's official download page and says
  what to pick afterwards. For Igir that is the releases page of its repository.
- **Only an executable file is accepted:** its name ends in `.exe` and it starts with
  the header of a Windows program. A `.cmd`, `.bat` or script is refused, with a message
  that points to the compiled executable.
- Igir publishes compiled executables (its documentation says they are built with Bun)
  and packages for npm, Homebrew and Scoop. Romio supports the compiled executable. A
  copy from a package manager is supported only where what it put on `PATH` is itself an
  executable file; npm installs `igir.cmd`, which is refused. Romio does not call
  `npx igir`.

## The runner

Two layers, shared by every adapter. Windows only in version 1.

```text
spawn_tracked(tool_path, args, work_dir, on_line, deadline) -> Tracked
Tracked.stop()                   ends the processes, and returns at once
Tracked.wait() -> RunOutcome     returns when the tracked processes are gone

start(context, tool_path, args, on_line) -> RunHandle
RunHandle.stop()                 the same
RunHandle.wait() -> RunOutcome   the same, after the journal row is completed

context    = { run_id, project_id, tool, tool_version, report_path, output_dir }
RunOutcome = Exited { exit_code, output_tail }
           | Stopped
           | FailedToStart { error }
```

- `spawn_tracked` owns the process: starting it, its job object, the pipes, Stop and the
  deadline. It knows nothing about projects or the journal. The version check uses it
  directly.
- `start` is `spawn_tracked` with no deadline, plus the journal row. Every run against a
  library goes through `start`.
- `context` is what `start` needs to write the journal row. The operation log is read
  per project, so the project id travels with the run. `run_id` is made by the caller and
  names the run everywhere: the row, the working folder, the report file.
- Runs in `spawn_blocking`. Stdout and stderr are each read by their own thread, at the
  same time, line by line, and passed to `on_line`, which an adapter uses to report
  progress. Reading one to its end before the other would hang the run: a tool that fills
  the unread pipe blocks, and never closes the one being read. `output_tail` is the last
  lines of both.
- **A tool that can't be started** (the file is gone, isn't a program, or the system
  refuses it) gives `FailedToStart` with the system's message. There is no exit code to
  show, and the screen doesn't invent one.
- A run has no time limit. Hashing a large library legitimately takes a long time.
- The Tauri shell plugin is not used for this. The process is started by the backend, so
  the webview never holds the ability to start programs.

**Starting the tool.** The order matters, and each step is there so that the tool never
does anything Romio has no hold on:

1. **The job.** A job object is made, set to end its processes when its last handle
   closes, and without the right to break away. Its handle can't be inherited, so no
   child ever holds the job open.
2. **The pipes.** One for stdout and one for stderr. Romio's ends can't be inherited.
   Stdin is the null device. If a pipe can't be made or the null device can't be opened,
   nothing is started and the outcome is `FailedToStart`.
3. **The process,** made with `CreateProcessW`, called directly. The standard library's
   `Command` can't do what this step needs. The call gets:
   - the accepted path as the program, and the command line: the accepted path again as
     its first word, then the argument list (rule 3);
   - the working directory, a folder Romio made for this run in its own data folder;
   - `CREATE_SUSPENDED`, so the tool does nothing yet;
   - the job, as a start-up attribute, so the process is in the job from the moment it
     exists and there is no time at which it is outside;
   - a list of the only handles the child may inherit: the null device and the two pipe
     ends meant for it. Two launches at once, such as a version check during a run,
     therefore can't pick up each other's pipes.

   Romio closes its own copies of the child's pipe ends as soon as the call returns.
4. **The record.** For a run against a library, the `pid` and start time are written to
   the journal row and committed, and the run's session marker is made (see "After a
   crash").
5. **Resume,** with the handle of the first thread that `CreateProcessW` returned. No
   thread is looked up.

If step 3, 4 or 5 fails, the job is ended and the outcome is `FailedToStart`. If Romio
dies at any step, the job closes and ends the process, which had not run before step 5.
Nothing the tool does happens outside the job or without a record.

**The command line.** One function builds it, for programs that read their arguments by
the rules Microsoft documents for its C start-up code ("Parsing C command-line
arguments"):

- **The first word is the program.** The program a process runs is chosen by the path
  passed apart from the line, but the tool still reads the line's first word as its own
  name. Without it the tool would take the verb for its name and lose it. So the line
  starts with the accepted path, always in quotes. A Windows path can't hold a quote, and
  the rules for the first word treat backslashes as plain characters, so it needs nothing
  more.
- **Each argument after it:** one that is empty, or holds a space, tab or quote, is put
  in quotes. A quote inside is written as a backslash and a quote. Backslashes are
  written as they are, except a run of them that comes right before a quote: that run is
  doubled. This covers the closing quote Romio adds, so an argument in quotes that ends
  in backslashes has them doubled.
- Arguments are joined with one space. Nothing else is added.

Igir's executable is taken to be such a program; a desktop check confirms it. Batch files
are not, which is one reason they are refused.

**Stop.** Stop ends the tool; it doesn't only stop listening to it. A tool that kept
hashing after Stop would hold the library and the writer lock, and write a report nobody
asked for.

- The backend keeps the `RunHandle` of the running tool. A `stop_tool_run(run_id)` command
  calls `stop()` on it.
- **What Stop ends:** every process in the job. That is the tool and everything it
  started, and everything those started: the job doesn't allow breakaway, so a descendant
  can't leave it. Stop ends the job at once. Windows has no polite request to send to a
  program without a window, and the spike found nothing lost by ending Igir outright.
- **When `wait()` returns:** when the job reports no active process. Waiting for the tool
  alone would not show that its helpers are gone.
- **The output pipes.** The child's ends were given to the tool alone (step 3), and Romio
  closed its copies. Only the tool and what it started can hold them, and those are all
  in the job. So the readers reach the end of both pipes once the job is empty. `wait()`
  joins both reader threads before it returns, and nothing is passed to `on_line` after
  that.
- Between Stop and the end the screen says "Stopping…". The run is still the one run
  allowed; another can start only after `wait()` has returned.
- **Closing Romio during a run** is a Stop: the window stays, saying "Stopping…", until
  `wait()` has returned, and then closes. Only a crash or a forced close leaves a run
  unsettled.

**Journal.** Each run is one `operation_log` row, using the write backbone's `record_json`:

```json
{ "version": 1, "kind": "tool_run",
  "tool": "igir", "tool_version": "...", "tool_path": "...",
  "args": ["report", "--dat", "..."],
  "started_at": "...", "ended_at": "...",
  "run_id": "...", "user_sid": "...", "pid": 1234, "pid_started_at": "...",
  "process_gone_at": "...",
  "outcome": "finished | failed | stopped | failed_to_start | interrupted",
  "exit_code": 0, "error": null,
  "output_dir": null, "report_path": "..." }
```

The row is written before the process is made, with outcome `interrupted`, the `user_sid`
of the Windows user Romio is running as, no `pid` and no `process_gone_at`. The `pid` and `pid_started_at` (the system's start time for that
process) are written in step 4, before the tool is resumed. The outcome and `ended_at`
are written when the run ends. `Exited` with code 0 is `finished`, any other code is
`failed`. `FailedToStart` is `failed_to_start`, with the system's message in `error` and
no `exit_code`: nothing was cut off, so the row must not stay `interrupted`. A tool run
is never resumed or repeated automatically.

`process_gone_at` is the moment Romio established that the run's processes were gone:
when `wait()` returned, or, after a crash, when the gate below found it so. A run without
it is **unsettled**.

**After a crash.** If Romio dies while a tool runs, the row stays `interrupted`, and
nothing may write to a library or start a tool until everything that run started is known
to be gone.

- **The job ends the tool.** The job object ends its processes when its last handle
  closes. Romio holds the only handle, so the tool and its helpers are ended when Romio
  is gone, however Romio ends.
- **But Romio can't watch it happen.** The system ends those processes shortly after, not
  at the same instant, and Romio's handle on the job died with it. Nothing can ask
  afterwards whether the job is empty. That the tool's own process has gone does not show
  that its helpers have. A second copy of Romio that was already open could meanwhile
  take the writer lock.
- **So Romio waits for the sign-in session to end.** Signing out of Windows, or
  restarting it, ends every process the user's session started. That is something Romio
  can check. Decided by the owner on 2026-11-17: after a crash or forced close during a
  tool run, Romio writes nothing and runs no tool until the user has signed out and in
  again. Scans and the read-only checks are not affected.
- **The session marker.** In step 4 Romio makes a registry key for the run, named by its
  `run_id`, under its own key in the user's part of the registry, as a volatile key.
  Windows keeps a volatile key in memory only and drops it when that user's registry is
  unloaded. It does not depend on the clock or on how long Windows has been up. A sign-out
  normally unloads the user's registry, but not always: Windows keeps it loaded while
  something still holds it open. A restart always unloads it, and so does a shutdown with
  Fast Startup, which signs every user out. When a run ends normally, Romio removes the
  key after it has written `process_gone_at`.
- **The marker belongs to one Windows user.** It is in the registry of the user who
  started the run, and another user's copy of Romio looks in another registry, where the
  key was never made. If two users share one data folder, a missing key would then prove
  nothing. So the row records the `user_sid`, and only a copy of Romio running as that
  user may read anything from the marker's absence.
- **The gate.** Whoever takes the writer lock first settles tool runs, beside the
  backbone's settling of `applying` rows: at start, before a tool run, and before each of
  Romio's own writes, root edits and project deletions. It goes by the journal: every
  `tool_run` row that is unsettled is looked at, in this order.
  1. *No `pid`.* The tool was never resumed: the `pid` is committed before step 5. Gone.
  2. *The run's marker is not there.* The run's `user_sid` is the user Romio is running
     as, Romio could read its own registry key, and the run's key is not in it. That
     user's registry has been unloaded since the run started, so the session that ran the
     tool has ended. Gone.
  3. *The marker is there, and the tool's own process is still running:* a process with
     that `pid` whose start time is `pid_started_at`, not yet exited. Alive. Refused with
     "a tool Romio started earlier is still ending. Try again in a moment."
  4. *The marker is there, and the tool's own process is gone,* or its `pid` now belongs
     to another process. The helpers can't be checked. Refused with "Romio can't tell
     whether a tool it started earlier is still running", and the reason: "Romio stopped
     while that tool was running. Sign out of Windows and sign in again. If Romio still
     says this afterwards, restart Windows."
  5. *Anything else:* the run was started by another Windows user (the reason says so,
     and that this user must open Romio, or Windows be restarted and that user open
     Romio), the row can't be read or understood, the registry can't be read,
     or the system refuses to say whether the process exists (it can't be opened, for a
     reason other than there being no such process). Refused with the same "can't tell"
     message, and the error.

  A run found gone is settled: `process_gone_at` is written and committed. If that
  can't be committed, the call is refused as in case 5 and the run is looked at again
  next time. Only after the commit is the run's marker removed, if there is one. If the
  marker can't be removed, nothing follows from it: the row is settled and is never
  looked at again, and a marker without an unsettled row means nothing. Windows drops it
  at the next unload.
- **A refusal releases the writer lock and writes no row.** Settling touches no file: it
  writes one field in the journal and removes one registry key of Romio's own.
- **Ways out.** For cases 3 and 4, signing out and in again is usually enough, and a
  restart of Windows always is: the marker is gone, and case 2 applies. A run started by
  another Windows user is settled when that user opens Romio after such a sign-out or
  restart. For a row that can't be read there is no such way, because
  the run's id, and so its marker, can't be found. That is the write backbone's case of a
  record Romio can't read, with the same message and the same remedy: open the version of
  Romio that wrote it, or keep a copy of the database and get help. The refusal carries
  the path of the database.
- **The process is held open** while its start time and state are read, so the answer is
  about one process and not about a number. A process that isn't there and a process
  that can't be opened are told apart: only the first counts as gone, in case 4.
- **What happened and what is alive are kept apart.** The row's outcome is history and
  stays `interrupted`. Whether something is alive is decided by the gate and recorded in
  `process_gone_at`.
- **Romio never ends a process it finds after a crash.** A `pid` is not enough to act on.
- **Outside the promise:** a user who removes the marker from the registry by hand tells
  Romio that the run is over. Nothing Romio or the tool does removes it.

## macOS and Linux: not in version 1

On Windows the system itself ends the tool when Romio is gone. macOS and Linux have
nothing equivalent, and three rounds of review found no design for them that holds. The
owner decided on 2026-11-17 that version 1 runs tools on Windows only.

- On macOS and Linux the adapter's screen says "Running tools is available on Windows in
  this version", and the backend refuses to start a run. `build` and `parse` are not
  tied to a system and are tested on all three.
- A design for these systems has to answer what the rejected ones could not:
  - **Ending the tool when Romio dies.** A process group is not ended with the process
    that made it.
  - **Knowing that a run is alive** by something the tool can't undo. A lock on a file
    handed to the tool as its stdin was tried on paper and rejected: the tool can close
    its stdin, and a helper can be given another.
  - **Signalling a process group** without the group's number being given to someone else
    between the check and the signal.
  - **Knowing that a group is empty,** including a helper that left it.
- That design gets its own spec and its own spike on each system. Nothing in this spec is
  written to be ready for it.

## First action: audit with Igir

**What the user gets:** for each DAT file they supply, which of its games their library
has, which are missing, and which library files match nothing.

**The command**

```text
igir report --dat <dat folder or file>... --input <library root>...
            --report-output <file> --cache-path <file>
```

`--cache-path` is not optional for Romio. Without it Igir writes `igir.cache` into the
user's home folder, which the spike saw happen. With it, the cache goes into Romio's data
folder. `--temp-dir` is never passed: Igir removed the folder the spike gave it when it exited.

From Igir's documentation:

- `report` can run by itself. Then Igir "copies, moves, and deletes no files".
- At least one DAT is required.
- The report is a CSV. `--report-output` sets where it is written.
- Its Status column holds `FOUND`, `MISSING`, `DUPLICATE` (a file that matched a game but
  wasn't the one used) and `UNUSED` (a file that matched nothing). `DELETED` only appears
  with `clean`, which Romio never runs. The documentation names `IGNORED` without
  explaining it.

**Igir's verbs and this adapter's allow-list**

| Verb | What Igir's documentation says it does | Allowed |
|---|---|---|
| `report` | Reports which inputs matched which DATs | Yes |
| `test` | Verifies files; no writes described | Later, with copy-out |
| `copy` | Writes to output; input untouched | Later, with copy-out |
| `extract`, `zip` | Change how `copy` writes | Later, with copy-out |
| `playlist` | Writes `.m3u` files | No. Romio's own writer is planned, on the write backbone. |
| `dir2dat`, `fixdat` | Write a DAT file | No, not in version 1 |
| `link` | Creates links to input files | No. Copies only (PRD decision 4). |
| `move` | Deletes the source "if it's safe to do so" | Never |
| `clean` | "Files in the output directory that do not match any ROM in any DAT will be deleted." | Never |

`--overwrite` and `--overwrite-invalid` are never emitted. Igir's default is that it "will
not overwrite or delete any files already in the output directory".

**The form**

| Field | Type | Becomes |
|---|---|---|
| DAT files | one or more files or folders, chosen with the picker | `--dat` |
| Library roots | the project's roots; shown, not editable | `--input` |

The report path is not a field. Romio writes it into its own data folder, one file per
run, named by the run's id, so an audit puts nothing in the library and nothing beside the
DATs. A path is never used twice. A journal row's `report_path` therefore points at that
run's results or, once the file has been removed, at nothing; never at a later run's. The
cache file is one per project, in the same data folder, and is the only file a later run
reuses.

**DAT files** are the user's, like BIOS files. Romio doesn't ship, download or link to
them. The screen says what a DAT is and names the preservation groups that publish them.

**Reading the report.** The columns in 5.8.1 are `DAT Name`, `Game Name`, `Status`,
`ROM Files`, then fourteen true/false columns (`Patched`, `BIOS`, `Retail Release` and
others). A `DUPLICATE` or `UNUSED` row has an empty DAT and game name, and the file in
`ROM Files`. The file has one row per game and per unmatched file, so it is large: 25 MB
for 100,000 files. `parse` reads it as a stream and by column name, not position. A report whose
header lacks a column Romio needs is an error that names the column, not a guess. Unknown
status values are counted and shown as "other", never dropped.

**What the screen shows**

- Per DAT: games found, games missing, with the lists behind each number.
- Files that matched nothing, and files that are duplicates of a game already matched.
- The command that ran, how long it took, and where the CSV is, with "Show in folder".
- If the run failed: the exit code and the last lines Igir wrote. Igir writes its errors
  to stdout, as a line starting `ERROR:`; stderr stayed empty in every spike run.
- **Progress is by step, not by percentage.** With its output piped, Igir prints one line
  as each step finishes ("Parsing DATs", "Scanning for ROMs", one per DAT, "Generating
  report") and nothing in between, wrapped in terminal control codes that the adapter
  strips. The screen shows the step it is on and the time elapsed, with Stop.

The audit is another read-only scan screen. It uses the shared scan session
(`src/lib/tool-scan.ts`) to keep results and inputs per project, but not that session's
Stop. `stopTool` there only ignores whatever the backend returns later, which is right for
Romio's own short scans and wrong for a tool that would go on hashing. The audit's Stop
calls `stop_tool_run`, and the session is marked stopped when the backend reports that the
run has ended. The session gains a "stopping" state for the time between.

**Cost.** An audit hashes every file in the library. The spike's 100,000 files of 1 KB
took 153 seconds, and 69 seconds on a second run with the cache. Real libraries hold far
more bytes, so expect minutes to hours. The screen says so before the first run. The cache only helps a run that finished: a stopped audit starts again from nothing.

## Later: copying a library out (outline)

The Export Planner becomes "make a clean copy for a frontend". Its own spec will define
it; this is what already seems fixed:

- `igir copy [extract|zip] test`, with `--output` pointing at a folder that passes rule 5
  and is empty when the run starts.
- The preview is an audit: what is `FOUND` is what would be copied, with a size estimate.
- Igir has output tokens for Batocera (`{batocera}`), EmulationStation (`{es}`) and
  RetroDECK (`{retrodeck}`). Its documentation lists none for ES-DE, RetroBat or
  LaunchBox. Romio already maps system folders per frontend, so it may have to supply the
  layout itself through Igir's `--output-console-tokens` file.
- One game, one ROM (`--single` and its preferences) is the form's main content.
- A copy that is stopped or fails leaves a partial output folder. Romio doesn't delete it;
  the entry says so.

Questions that spec must answer, raised in review of the PRD amendment (PR 58):

- **A half-written output folder.** How it is marked so that nobody takes it for a
  finished copy. Removing it is a deletion, which waits for the rollback spec.
- **The library changing between the preview and the run.** The tool reads the library
  again when it runs, and a library can't be frozen. Whether the result screen compares
  the run's own report with the preview, or only shows the report.
- **Two runs into one folder.** Rule 8 allows one run at a time and the folder must be
  empty at the start, so runs can't mix. The spec confirms that a retry needs a new or
  emptied folder too.

## Testing

- **`build`:** for every combination of form values, the argument list contains no verb
  outside the allow-list, no overwrite option, and every `--input` is a project root. A
  path with spaces, quotes or a leading dash is passed as one argument and can't become an
  option.
- **`parse`:** fixtures of report CSVs: each status, a missing column, an unknown status,
  an empty report, and a file with a byte-order mark.
- **The runner,** against a stand-in program built for the tests: it prints a version,
  writes a CSV, can be told to hang, to fail, to start a child, and to fill one output
  stream while holding the other open. Tests cover a normal run, a failing run, a path
  that can't be started (the row ends `failed_to_start`), Stop while hung, Stop with a
  child process (the child is gone afterwards), a tool that exits and leaves a child
  running (`wait()` returns only when the child is gone too), more than a pipe's worth of
  output on stderr with stdout silent, and a crash mid-run leaving an `interrupted` row.
  The stand-in records whether it was in a job at its first instruction, and it always
  was.
- **Each step of the start,** made to fail through a seam: the job can't be made or
  set up, a pipe can't be made, the null device can't be opened, the process can't be
  made, the journal commit fails, the marker can't be made, the resume fails. In every case no process is left, the outcome is `failed_to_start`,
  and the stand-in never ran.
- **Handles:** a second launch made while a run is going holds none of the run's pipe
  ends and not its job, and the run's readers still end when its job is empty.
- **The command line:** the stand-in sees its own path as its name and every argument
  exactly as given: an empty one, ones with spaces, tabs and quotes, one ending in a
  backslash, one ending in backslashes before a quote, and one with characters outside
  ASCII. One case has the stand-in at a path with spaces and an argument with a space
  that ends in a backslash, together. A `.cmd` file, a
  `.bat` file and a file named `.exe` that isn't a program are refused before anything
  runs.
- **The version check:** it runs with no project, writes no row, runs beside a tool run,
  and a stand-in that hangs is ended at the deadline and its path refused.
- **After a crash:** the process that held the job is killed, and the stand-in and a
  child it started are gone soon after. For the gate, each case by its number:
  1. an unsettled row with no `pid` is settled;
  2. a row whose marker is absent is settled, whatever process now has its `pid`, and
     that process is untouched;
  3. a marker and a live stand-in with the recorded start time refuse as alive;
  4. a marker and no such process, a marker and an exited stand-in whose handle is still
     held open by the test, a marker and a `pid` that now belongs to another process, and
     a marker with the tool gone but a helper still alive, each refuse with the sign-out
     reason;
  5. a row whose `user_sid` is another user's, with and without a marker in this user's
     registry, a row that can't be read, a registry that can't be read, a process that
     can't be opened, and a settling that can't be committed, each refuse with the error.

  A marker that can't be removed after settling leaves the run settled.

  Every refusal blocks a tool run and each of Romio's own writes, from a second process
  as well, and leaves no row.

  What ends a refusal is tested case by case, and nothing else ends it:
  - a row that can be read, started by this user, whose marker is then removed as a
    sign-out removes it, and whose settling commits: the next call goes through, and the
    run is never looked at again;
  - case 3, with the marker still there: the call is still refused after the stand-in
    has gone, now with the sign-out reason of case 4;
  - a row from another user: still refused after the marker is removed from this user's
    registry, and after the stand-in has gone;
  - a row that can't be read: still refused whatever is done to markers and processes;
  - a registry that can't be read: refused until it can be;
  - a settling that can't be committed: refused, with the marker absent, until the
    commit succeeds.
- **Closing Romio during a run** leaves the run settled and no marker.
- **macOS and Linux:** starting a run is refused with the stated message.
- **Reports:** two runs for one project write two files, and the first run's row still
  points at the first file.
- **Finding the tool:** nothing is run for a path the user hasn't accepted, and a stored
  file whose size or modified time changed is asked about again.
- **Output folder rule:** a library root, a folder inside one, a folder containing one,
  and a folder that doesn't exist yet under a root are refused. A project whose root contains Romio's data folder is refused an audit.
- **Not automated:** that Windows itself drops the marker. A test that deletes the marker
  only exercises case 2. On the desktop, by hand, on every adapter PR: a run is cut off
  by ending Romio, and the marker is looked for after a sign-out, after a restart and
  after a shutdown with Fast Startup. The real Igir is also given a path with spaces and
  an argument that ends in a backslash, and its report is checked for both.
- Automated tests never run the real Igir. Gemini does, on the desktop, against a
  generated library and a hand-written DAT, on every adapter PR.

## What the spike found

Igir 5.8.1, official `igir-5.8.1-Windows-x64.zip` from the project's releases page, its
SHA-256 checked against the one GitHub publishes. Run on Windows 11 against two generated
libraries: seven small files with a hand-written DAT, and 100,000 files of 1 KB.

| Question | Answer |
|---|---|
| Does the executable need Node.js? | It is one 121 MB file whose banner names its own Bun runtime. Node.js was installed on the test machine, so "runs without it" is likely, not shown. |
| What does it print when piped? | A banner, then one line per finished step, in terminal control codes. No running count. 797 bytes over a 153 second run. |
| The report's columns | As listed under "Reading the report". `IGNORED` did not appear. |
| Exit codes | 0 on success. 1 for a usage error and for a DAT folder with no files. Being killed is the caller's code. |
| The version | In the banner only. `--help` exits 0; `--version` exits 1. |
| What Stop leaves | Killed after 20 seconds: no process left, no report, no cache file. The cache is written at the end, so a stopped audit keeps none of its hashing. |
| The cache | `igir.cache` in the user's home folder by default. `--cache-path` moves it. 1.4 MB for 100,000 files. |
| A large audit | 153 seconds for 100,000 files of 1 KB; 69 seconds cached. |

Two things the spike found that nobody asked:

- **Igir deletes the folder given as `--temp-dir`** when it exits. Romio never passes it.
- **`clean` sends files to the recycle bin** by its own description, and has
  `--clean-dry-run`. It stays off the allow-list.

Still unchecked:

- macOS and Linux. Everything above is Windows x64.
- Stopping Igir when it has started helper processes. None were seen in an audit.
- Everything under "Starting the tool", "Stop" and "After a crash" is design, not
  something the spike ran. The spike killed one Igir process on Windows. The job object,
  the start-up attributes, the command-line function and the gate are untested until the
  runner exists.
- That a volatile key in the user's registry is gone after a restart and after a
  shutdown with Fast Startup, how often it survives a sign-out, and that it is never
  dropped while the session lives. The design
  rests on Microsoft's description of volatile keys; it has not been tried.
- That Igir reads its command line the way the command-line function assumes.
- Real DAT files from the preservation groups, and archives as input.
- Whether the report's columns are stable between Igir versions. The adapter supports
  5.8.x until another version has been run.

## Decisions for the owner

1. **Where DAT files are remembered.** Recommended: per project, since different projects
   audit different systems.
2. **The screen's name.** Recommended: "Audit", in the sidebar beside Format Check.
3. **Keeping reports.** Each run writes its own file. Recommended: Romio keeps the file of
   the last finished audit per project and deletes the older ones when a new audit
   finishes. An older run's entry then says its report is no longer kept. They are in
   Romio's own data folder, not the library.

## Licence

Igir is GPL-3.0, read from its repository. Romio is GPL-3.0 and runs Igir as a separate
program, without shipping it.
