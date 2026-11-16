# Tool Adapters — Design Spec

**Status:** Draft. No code yet. Facts about Igir come from its own documentation (igir.io,
read 2026-11-16) and from a spike on the same day: Igir 5.8.1, the official Windows x64
executable, run against generated libraries. "What the spike found" has the results, and
what is still unchecked on macOS and Linux.
**Scope:** How Romio runs someone else's program against a user's library, and the first
adapter: Igir, auditing a library against DAT files. Copying a library out through Igir
(the Export Planner) is outlined, and gets its own spec.
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
2. Anything a tool writes goes to a folder that is not the library and not inside it.
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
3. **No shell.** The tool is started directly with its argument list. Nothing is joined
   into a command string and nothing is interpreted by a shell.
4. **Inputs are the project's library roots,** and only those.
5. **Output goes outside the library.** An output folder must not be a library root, sit
   inside one, or contain one. The check is the write backbone's containment check, by
   folder identity. The same check covers what Romio itself hands the tool: the report
   file, the cache file and the working folder. If Romio's data folder is inside one of the
   project's library roots (a root set to the user's home folder, say), the adapter refuses
   to run and says why, since the report and cache would land in the library.
6. **Known versions only.** The adapter reads the tool's version and refuses one it wasn't
   written for. Reading a tool's output breaks when its format changes.
7. **Show the command.** Before running, and in the journal afterwards, as it would be
   typed in a terminal on this system.
8. **One tool run at a time,** under the write backbone's writer lock, so a tool never
   runs while Romio itself is writing. The lock is held until the tool's processes are
   gone, not until Stop is pressed. A run left over from a crash also counts: see "After a
   crash".
9. **Romio installs nothing.** Version 1 finds a copy the user installed. It never
   downloads a tool and never runs one through a package runner that downloads code
   (`npx`, `bunx`).

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
  no library path, runs in an empty folder in Romio's data folder through the same runner
  code, and is ended after ten seconds. The screen shows the command beside the path
  before the user accepts.
- If nothing is found, the screen links to the tool's official download page and says
  what to pick afterwards. For Igir that is the releases page of its repository.
- Igir publishes compiled executables (its documentation says they are built with Bun)
  and packages for npm, Homebrew and Scoop. Romio supports the compiled executable and
  whatever a package manager put on `PATH`. It does not call `npx igir`.

## The runner

One function, shared by every adapter:

```text
start(context, tool_path, args, on_line) -> RunHandle
RunHandle.stop()                 asks the run to end, and returns at once
RunHandle.wait() -> RunOutcome   returns when the tool's processes are gone

context    = { run_id, project_id, tool, tool_version, report_path, output_dir }
RunOutcome = Exited { exit_code, output_tail }
           | Stopped
           | FailedToStart { error }
```

- `context` is what the runner needs to write the journal row. The operation log is read
  per project, so the project id travels with the run. `run_id` is made by the caller and
  names the run everywhere: the row, the working folder, the report file.
- Started with `std::process::Command`: the tool path, the argument list, stdin closed,
  the working directory set to a folder Romio made for this run in its own data folder.
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

**Stop.** Stop ends the tool; it doesn't only stop listening to it. A tool that kept
hashing after Stop would hold the library and the writer lock, and write a report nobody
asked for.

- The backend keeps the `RunHandle` of the running tool. A `stop_tool_run(run_id)` command
  calls `stop()` on it.
- Stop ends the tool and every process it started, on every system. A compiled tool may
  start helpers, and a helper left alive keeps reading the library.
  - **Windows:** the tool is put in a job object when it starts, and Stop ends the job.
  - **macOS and Linux:** the tool is started as the leader of its own process group, and
    Stop signals the group: a request to end first, then a kill after five seconds.
- The runner doesn't wait for the output pipes to close before it returns. A helper that
  survived would hold them open and the run would never end. Once the tool's processes
  have been ended the readers are abandoned, and `wait()` returns `Stopped`.
- Between Stop and the end the screen says "Stopping…". The run is still the one run
  allowed; another can start only after `wait()` has returned.
- A helper started in the instant before the job object is assigned on Windows would be
  outside it. The implementation PR says whether that gap is closed, by starting the tool
  suspended, or accepted.

**Journal.** Each run is one `operation_log` row, using the write backbone's `record_json`:

```json
{ "version": 1, "kind": "tool_run",
  "tool": "igir", "tool_version": "...", "tool_path": "...",
  "args": ["report", "--dat", "..."],
  "started_at": "...", "ended_at": "...",
  "run_id": "...", "pid": 1234,
  "outcome": "finished | failed | stopped | failed_to_start | interrupted",
  "exit_code": 0, "error": null,
  "output_dir": null, "report_path": "..." }
```

The row is written before the process starts, with outcome `interrupted` and no `pid`. The
`pid` is added once the process exists, and the outcome when it ends. `Exited` with code 0
is `finished`, any other code is `failed`. `FailedToStart` is `failed_to_start`, with the
system's message in `error` and no `exit_code`: nothing was cut off, so the row must not
stay `interrupted`. A tool run is never resumed or repeated automatically.

**After a crash.** If Romio dies while a tool runs, the row stays `interrupted`, and the
tool must not be left running where a new audit could start beside it.

- **Windows:** the job object is set to end its processes when its last handle closes.
  Romio holds the only handle, so the tool ends with Romio, however Romio ends.
- **macOS and Linux:** nothing ends the tool for Romio. At the next start, for each
  `interrupted` tool run, Romio looks for a live process with the recorded `pid` whose
  program is the recorded `tool_path` (the path guards against the number having been
  given to another program since). If there is one, the screen says an audit from before
  is still running and offers Stop, which signals that process group. No tool run starts
  until it is gone.
- Settling leaves the row `interrupted` either way: the run was cut off, whatever happened
  to the process afterwards.
- Not covered: on macOS and Linux, a helper that outlives the tool itself after a crash.
  The check finds the tool by its `pid`, and finds nothing if only a helper is left.

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
| `playlist` | Writes `.m3u` files | No. Romio has its own writer. |
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
  child process (the child is gone afterwards, on each system CI runs), a child that
  holds the pipes open after Stop (`wait()` still returns), more than a pipe's worth of
  output on stderr with stdout silent, and a crash mid-run leaving an `interrupted` row.
- **After a crash:** an `interrupted` row whose `pid` is a live stand-in blocks a new run
  and can be stopped; one whose `pid` now belongs to a different program is ignored.
- **Reports:** two runs for one project write two files, and the first run's row still
  points at the first file.
- **Finding the tool:** nothing is run for a path the user hasn't accepted, and a stored
  file whose size or modified time changed is asked about again.
- **Output folder rule:** a library root, a folder inside one, and a folder containing one
  are refused. A project whose root contains Romio's data folder is refused an audit.
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
- Everything under "Stop" and "After a crash" is design, not something the spike ran. The
  spike killed one Igir process on Windows. Job objects, process groups and the check at
  the next start are untested until the runner exists.
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
