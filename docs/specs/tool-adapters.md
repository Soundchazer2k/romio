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
3. The exact command is shown before it runs and recorded after.
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
   folder identity.
6. **Known versions only.** The adapter reads the tool's version and refuses one it wasn't
   written for. Reading a tool's output breaks when its format changes.
7. **Show the command.** Before running, and in the journal afterwards, as it would be
   typed in a terminal on this system.
8. **One tool run at a time,** under the write backbone's writer lock, so a tool never
   runs while Romio itself is writing.
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
- the shared runner, which starts the process, streams progress, supports Stop and
  records the run.

There is no plugin system and no adapter loaded at run time. The trait exists so that the
second adapter has a shape to follow; it is revised when that adapter is written.

## Finding the tool

- Romio looks for the tool on `PATH`, then asks the user to pick the file. The chosen path
  is stored in app settings, not in a project: the tool belongs to the machine.
- `probe` runs the tool and reads its version. A file that doesn't answer like the tool is
  refused. Igir has no version flag: `--version` is an error. `igir --help` exits 0 and
  prints a banner holding `v5.8.1 (Bun v1.4.4)`, which is what `probe` reads.
- If nothing is found, the screen links to the tool's official download page and says
  what to pick afterwards. For Igir that is the releases page of its repository.
- Igir publishes compiled executables (its documentation says they are built with Bun)
  and packages for npm, Homebrew and Scoop. Romio supports the compiled executable and
  whatever a package manager put on `PATH`. It does not call `npx igir`.

## The runner

One function, shared by every adapter:

```text
run(tool_path, args, work_dir, on_line) -> RunOutcome { exit_code, stopped, stderr_tail }
```

- Started with `std::process::Command`: the tool path, the argument list, stdin closed,
  the working directory set to a folder Romio made for this run in its own data folder.
- Runs in `spawn_blocking`. Stdout and stderr are read line by line and passed to
  `on_line`, which an adapter uses to report progress.
- **Stop** ends the process. On Windows that means the whole process tree, since a
  compiled tool may start helpers.
- A run has no time limit. Hashing a large library legitimately takes a long time.
- The Tauri shell plugin is not used for this. The process is started by the backend, so
  the webview never holds the ability to start programs.

**Journal.** Each run is one `operation_log` row, using the write backbone's `record_json`:

```json
{ "version": 1, "kind": "tool_run",
  "tool": "igir", "tool_version": "...", "tool_path": "...",
  "args": ["report", "--dat", "..."],
  "started_at": "...", "ended_at": "...",
  "outcome": "finished | failed | stopped | interrupted", "exit_code": 0,
  "output_dir": null, "report_path": "..." }
```

The row is written before the process starts, with outcome `interrupted`, and updated when
it ends. A row still `interrupted` at the next start was cut off by a crash; settling
leaves it as it is. A tool run is never resumed or repeated automatically.

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
run, so an audit puts nothing in the library and nothing beside the DATs.

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
(`src/lib/tool-scan.ts`): results and inputs are kept per project, and Stop drops a run.

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
  writes a CSV, can be told to hang, to fail, and to start a child. Tests cover a normal
  run, a failing run, Stop while hung, Stop with a child process, and a crash mid-run
  leaving an `interrupted` row.
- **Output folder rule:** a library root, a folder inside one, and a folder containing one
  are refused.
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
- Real DAT files from the preservation groups, and archives as input.
- Whether the report's columns are stable between Igir versions. The adapter supports
  5.8.x until another version has been run.

## Decisions for the owner

1. **Where DAT files are remembered.** Recommended: per project, since different projects
   audit different systems.
2. **The screen's name.** Recommended: "Audit", in the sidebar beside Format Check.
3. **Keeping reports.** Recommended: Romio keeps the CSV of the last audit per project and
   replaces it on the next. They are in Romio's own data folder, not the library.

## Licence

Igir is GPL-3.0, read from its repository. Romio is GPL-3.0 and runs Igir as a separate
program, without shipping it.
