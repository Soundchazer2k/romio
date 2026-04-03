# Save Migration Safety Backbone — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Scope:** Phases 1–4 of safe save migration: real checkpoints, persistent operation log, trustworthy plan generation, and gated execution UI.

---

## Problem Statement

The Save Migration screen exists but its safety backbone is hollow:

- `create_save_checkpoint` returns a stub error
- `execute_migration` returns a stub error
- `get_operation_log` returns an empty vec
- The `MigrationPlanModal` destination is hardcoded as `root.path + "_new"` — wrong
- The UI accepts freeform input without requiring an active project
- `OperationLogEntry` has no `project_id` in the Rust model or TS types, even though the DB column exists

This spec makes the backbone real: checkpoints become genuine zip archives with durable metadata, the operation log becomes readable persisted data, migration planning uses the correct destination from the registry, and the execute button becomes an honest disabled state with real precondition checks.

---

## Architecture Overview

```
SavesScreen (project-gated)
    ├── discoverSaveRoots → engine::save_registry (no project_id — signature unchanged)
    ├── createMigrationPlan(projectId, source, destination, emulator)
    ├── createSaveCheckpoint(projectId, source, emulator) → engine::save_checkpoint → db::checkpoints + db::operation_log
    ├── getCheckpoints(projectId) → db::checkpoints
    └── getOperationLog(projectId) → db::operation_log

engine::save_checkpoint   ← pure, no Tauri/DB deps
engine::save_registry     ← discovery + plan (existing, gains expected_destination)
db::checkpoints           ← CRUD for save_checkpoints table
db::operation_log         ← CRUD for operation_log table
commands::save            ← thin IPC: call engine, persist, return
commands::rollback        ← get_operation_log becomes real; rollback stays disabled
```

---

## Section 1: Data Layer

### Migration 004

Both `save_checkpoints` and `operation_log` tables already exist in `001_initial.sql`. Migration 004 adds the missing per-project indexes that make list queries efficient:

**File:** `src-tauri/src/db/migrations/004_save_indexes.sql`

```sql
-- Add per-project indexes for save_checkpoints and operation_log.
-- Both tables were created in 001_initial.sql but lacked these indexes.
CREATE INDEX IF NOT EXISTS idx_save_checkpoints_project ON save_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_project    ON operation_log(project_id);
```

**`src-tauri/src/db/mod.rs`** — extend the `run_migrations` function:

```rust
fn run_migrations(conn: &Connection) -> Result<()> {
    // version is a snapshot of PRAGMA user_version read once at startup.
    // Each if-gate checks this original value independently (same pattern as migrations 1–3).
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
        conn.execute_batch("PRAGMA user_version = 1")?;
    }
    if version < 2 {
        conn.execute_batch(include_str!("migrations/002_scan_stats.sql"))?;
        conn.execute_batch("PRAGMA user_version = 2")?;
    }
    if version < 3 {
        conn.execute_batch(include_str!("migrations/003_bios.sql"))?;
        conn.execute_batch("PRAGMA user_version = 3")?;
    }
    if version < 4 {
        conn.execute_batch(include_str!("migrations/004_save_indexes.sql"))?;
        conn.execute_batch("PRAGMA user_version = 4")?;
    }

    Ok(())
}
```

Also add module declarations and a transaction helper:

```rust
pub mod projects;
pub mod bios;
pub mod format;
pub mod save;
pub mod emulator;
pub mod artifacts;
pub mod checkpoints;      // ← new
pub mod operation_log;    // ← new

// ... existing with_conn ...

/// Opens a rusqlite transaction and passes it to `f`. Commits on Ok, rolls back on Err.
pub fn with_transaction<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&rusqlite::Transaction) -> Result<T>,
{
    let mut guard = DB.lock().unwrap();
    let conn = guard.as_mut().ok_or_else(|| anyhow::anyhow!("DB not initialized"))?;
    let tx = conn.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}
```

`with_transaction` is needed by `commands::save::create_save_checkpoint` to atomically insert both the checkpoint row and the operation log entry in a single transaction.

### Model Changes

**`src-tauri/src/models/save.rs` — `SaveCheckpoint` gains `project_id`:**

```rust
pub struct SaveCheckpoint {
    pub id:           String,
    pub project_id:   String,   // ← new
    pub emulator:     String,
    pub source_path:  String,
    pub archive_path: String,   // absolute path
    pub created_at:   DateTime<Utc>,
    pub file_count:   u64,
    pub size_bytes:   u64,
}
```

**`src-tauri/src/models/validation.rs` — `OperationLogEntry` gains `project_id`:**

```rust
pub struct OperationLogEntry {
    pub id:             Uuid,
    pub project_id:     String,   // ← new (was missing, column already in DB)
    pub operation:      String,
    pub description:    String,
    pub affected_paths: Vec<String>,
    pub reversible:     bool,
    pub rolled_back:    bool,
    pub created_at:     DateTime<Utc>,
}
```

**`src-tauri/src/models/save.rs` — `SaveRoot` gains `expected_destination`:**

```rust
pub struct SaveRoot {
    pub path:                 String,
    pub emulator:             String,
    pub is_symlink:           bool,
    pub real_path:            Option<String>,
    pub file_count:           u64,
    pub size_bytes:           u64,
    pub migration_state:      SaveMigrationState,
    pub expected_destination: Option<String>,  // ← new: runtime only, never persisted
}
```

Set for `MigrationNeeded` and `ConflictDetected` states. `None` for `AlreadyMigrated` and `NotApplicable`.

**`src-tauri/src/models/save.rs` — `MigrationBlocker` enum (new):**

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationBlocker {
    NoActiveProject,
    CheckpointRequired,
    PlanRequired,
    ConflictDetected,
}
```

Used as the error type for `execute_migration` so the frontend can render specific unmet preconditions.

### DB Modules

**`db::checkpoints` (`src-tauri/src/db/checkpoints.rs`) — new:**

Functions:

- `insert(checkpoint: &SaveCheckpoint) -> anyhow::Result<()>` — calls `db::with_conn`, validates `project_id` non-empty with `Err(anyhow!("project_id is required"))`
- `insert_tx(tx: &rusqlite::Transaction, checkpoint: &SaveCheckpoint) -> anyhow::Result<()>` — writes within a caller-supplied transaction (used by `create_save_checkpoint` command)
- `list(project_id: &str) -> anyhow::Result<Vec<SaveCheckpoint>>` — filters out rows where DB `project_id` is NULL (defensive read)
- `get(id: &str) -> anyhow::Result<SaveCheckpoint>`

**`u64` column mapping note:** `file_count` and `size_bytes` are `u64` in the Rust model but SQLite stores all integers as `i64`. Row mapping must read these columns as `i64` then cast: `row.get::<_, i64>(n)? as u64`. This applies to both `list` and `get`.

Validation policy: empty `project_id` returns `Err(anyhow!("project_id is required"))` — no panic.

Defensive reads: rows where `project_id` IS NULL are silently filtered from list results. This handles any legacy rows; no migration needed.

**`db::operation_log` (`src-tauri/src/db/operation_log.rs`) — new:**

- `insert(entry: &OperationLogEntry) -> anyhow::Result<()>` — calls `db::with_conn`, validates `project_id`
- `insert_tx(tx: &rusqlite::Transaction, entry: &OperationLogEntry) -> anyhow::Result<()>` — writes within a caller-supplied transaction
- `list(project_id: &str) -> anyhow::Result<Vec<OperationLogEntry>>` — filters NULL `project_id` rows
- `mark_rolled_back(id: &str) -> anyhow::Result<()>` — sets `rolled_back = 1`

**`OperationLogEntry.id` serialization:** `id` is `Uuid` in the Rust model. When writing to SQLite, serialize as `entry.id.to_string()`. When reading back, parse with `Uuid::parse_str(&id_str).unwrap_or_default()` — matching the pattern used in `db/projects.rs`.

**Affected paths column:** Stored as a JSON array string (`serde_json::to_string`/`from_str`), same pattern as `library_roots` in `db/projects.rs`.

---

## Section 2: Engine Layer

### `engine::save_checkpoint` (new module)

**File:** `src-tauri/src/engine/save_checkpoint.rs`

Pure Rust — no Tauri or DB dependencies. Archive-creation logic only.

`src-tauri/src/engine/mod.rs` adds: `pub mod save_checkpoint;`

**Signature:**

```rust
pub fn create_checkpoint(
    project_id:   &str,
    source:       &Path,
    emulator:     &str,
    app_data_dir: &Path,
) -> Result<SaveCheckpoint>
```

**Behaviour:**

1. Validate `source` exists and is a directory. Return `Err` immediately if not.
2. Generate archive path: `{app_data_dir}/checkpoints/{uuid}.zip`. Create the `checkpoints/` directory if missing.
3. Walk `source` tree. For each file:
   - Compute its path **relative to `source`**, **without a leading slash** (e.g., `memcards/mc0.mc`)
   - Add to zip with that relative path as the entry name
   - Accumulate `file_count` and `size_bytes` during the walk — no second pass
4. **Atomic failure guarantee:** on any error during zip creation — I/O failure, permission error, interrupted walk — delete the partial `.zip` file before returning `Err`. Never return a `SaveCheckpoint` for an incomplete archive.
5. Return a fully-populated `SaveCheckpoint` with absolute `archive_path`. No DB writes.

**Archive format details:**
- File-only entries. Empty directories are not preserved. This is acceptable for save data — emulators create directories when writing saves.
- Entry paths are relative, no leading slash: `saves/duckstation/memcards/mc0.mc` ✓

**New dependency:** `zip = "2"` added to `src-tauri/Cargo.toml` under `[dependencies]`.

### `engine::save_registry` — `expected_destination` fix

`discover_save_roots` fills `expected_destination` for applicable states. The existing `roots.push(SaveRoot { ... })` block at line 47 of `src-tauri/src/engine/save_registry.rs` is replaced in-place (not duplicated) to add the new field. All other field expressions match the actual local variables already in scope:

```rust
// Replace the existing roots.push(SaveRoot { ... }) block (lines 47–55) with:
roots.push(SaveRoot {
    path:                 active_path.to_string_lossy().to_string(),
    emulator:             rule.emulator.clone(),
    is_symlink:           symlink,
    real_path:            real.map(|p| p.to_string_lossy().to_string()),
    file_count:           stats.0,
    size_bytes:           stats.1,
    migration_state,
    expected_destination: match migration_state {
        SaveMigrationState::MigrationNeeded | SaveMigrationState::ConflictDetected =>
            Some(new_path.to_string_lossy().to_string()),
        _ => None,
    },
});
```

All identifiers match the surrounding scope: `active_path`, `symlink`, `real`, `stats`, `migration_state`, and `new_path` are all already defined before the push.

`build_migration_plan` signature is unchanged — it still accepts explicit `source` and `destination` paths. The fix is at the call site.

---

## Section 3: Commands Layer

### `commands::save` changes

**`create_save_checkpoint`** — becomes real:

```rust
pub async fn create_save_checkpoint(
    project_id: String,
    source:     String,
    emulator:   String,
    app_handle: tauri::AppHandle,
) -> Result<SaveCheckpoint, String>
```

Sequence:
1. Validate `project_id` non-empty
2. Derive `app_data_dir` from `app_handle.path().app_data_dir()`
3. Call `engine::save_checkpoint::create_checkpoint(...)` — returns `SaveCheckpoint` or `Err` (partial archive already deleted by engine)
4. Build the `OperationLogEntry` (`operation = "create_checkpoint"`, `affected_paths = [source, archive_path]`, `reversible = false`)
5. Call `crate::db::with_transaction(|tx| { db::checkpoints::insert_tx(tx, &checkpoint)?; db::operation_log::insert_tx(tx, &log_entry)?; Ok(()) })` — both rows committed atomically
6. If the transaction fails for any reason (either insert or commit): delete the created archive file, return `Err`
7. Return `Ok(checkpoint)`

This ensures no checkpoint artifact exists without a matching log entry, and no log entry exists without a checkpoint row.

**`create_migration_plan`** — gains `project_id`:

```rust
pub async fn create_migration_plan(
    project_id:  String,
    source:      String,
    destination: String,
    emulator:    String,
) -> Result<MigrationPlan, String>
```

Validates `project_id` non-empty and project exists in DB. Destination comes from the caller (sourced from `SaveRoot.expected_destination`) — the command does not resolve it independently.

**`get_checkpoints`** — new command:

```rust
pub async fn get_checkpoints(project_id: String) -> Result<Vec<SaveCheckpoint>, String>
```

Calls `db::checkpoints::list(&project_id).map_err(|e| e.to_string())`.

**`execute_migration`** — structured precondition check:

```rust
pub async fn execute_migration(
    project_id: String,
    _plan: MigrationPlan,
) -> Result<(), MigrationBlocker>
```

Returns `Err(MigrationBlocker::CheckpointRequired)` (or other applicable variant) — no file movement. The frontend does **not** call this command in the current phase: the "Execute Migration" button is always disabled and renders as `"Execution not yet available"`. The command is registered (so it compiles and does not break future callers) but `ipc.ts` does not expose a new `executeMigration` wrapper in this phase. The command signature adds `project_id` as a forward-looking addition; the existing `ipc.ts` call should be removed or kept disabled — no active IPC call for `execute_migration` is wired in the frontend during this phase.

### `commands::rollback` changes

**`get_operation_log`** — replaces `Ok(vec![])`:

```rust
pub async fn get_operation_log(project_id: String) -> Result<Vec<OperationLogEntry>, String> {
    crate::db::operation_log::list(&project_id).map_err(|e| e.to_string())
}
```

**`rollback_operation`** — remains disabled but with a clear message:

```rust
Err("Rollback execution not yet implemented — log entry preserved".to_string())
```

### `lib.rs`

Registers the new `get_checkpoints` command and updates the other changed signatures. The relevant section of the `.invoke_handler` call:

```rust
tauri::Builder::default()
    // ...
    .invoke_handler(tauri::generate_handler![
        // ... existing commands ...
        commands::save::create_save_checkpoint,
        commands::save::create_migration_plan,
        commands::save::get_checkpoints,         // ← new
        commands::save::execute_migration,
        commands::rollback::get_operation_log,
        commands::rollback::rollback_operation,
        // ... other existing commands ...
    ])
```

---

## Section 4: Frontend

### Blocked state

`SavesScreen` checks `activeProject` before rendering anything interactive:

```tsx
if (!activeProject) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-romio-gray">Open a project to use Save Migration.</p>
    </div>
  );
}
```

No input, no query, no spinner when there is no project.

### `discoverSaveRoots` — signature unchanged

`discoverSaveRoots` does not receive `projectId`. The backend signature is not changed. No contract drift.

### Project-scoped calls

All other IPC calls receive `activeProject.id`:
- `createMigrationPlan(activeProject.id, source, destination, emulator)`
- `createSaveCheckpoint(activeProject.id, source, emulator)`
- `getCheckpoints(activeProject.id)`
- `getOperationLog(activeProject.id)`

### Query guards

All `useQuery` calls use `enabled: !!activeProject`:

```tsx
const { data: log = [] } = useQuery({
  queryKey: ["operation-log", projectId],
  queryFn:  () => ipc.getOperationLog(projectId),
  enabled:  !!activeProject,
});
```

### Destination path fix

`SaveRootCard.onMigrate` passes `root.expectedDestination` — not `root.path + "_new"`:

```tsx
onMigrate={async () => {
  if (!root.expectedDestination) return; // hard stop, no fallback
  const plan = await ipc.createMigrationPlan(
    activeProject.id,
    root.path,
    root.expectedDestination,
    root.emulator
  );
  setSelectedPlan(plan);
}}
```

The "Plan Migration" button is disabled when `!root.expectedDestination`.

### `MigrationPlanModal` — checkpoint step

The modal gains a "Create Checkpoint" button, enabled when the plan is loaded. Flow:

1. Plan displayed — "Create Checkpoint" button enabled
2. Checkpoint creation in progress — button disabled with spinner
3. Checkpoint success — archive path, file count, size shown inline; confirmation checkbox becomes available
4. Checkpoint failure — error displayed in modal, user can retry
5. "Execute Migration" — **always disabled** (not clickable). Label: `"Execution not yet available"`. No button that calls `executeMigration`.

After checkpoint creation succeeds:
```tsx
queryClient.invalidateQueries({ queryKey: ["checkpoints", projectId] });
queryClient.invalidateQueries({ queryKey: ["operation-log", projectId] });
```

### Operation log section

New collapsible section at the bottom of `SavesScreen`:

```tsx
<section>
  <h2>Migration History</h2>
  {log.length === 0
    ? <p className="text-romio-gray text-sm">No migration operations recorded yet.</p>
    : log.map(entry => <OperationLogRow key={entry.id} entry={entry} />)
  }
</section>
```

No rollback button exposed. `rolled_back` shown as a read-only badge if true.

### IPC and type updates

**`src/lib/ipc.ts`:**

Updated import line (add `OperationLogEntry` alongside existing save types):
```ts
import type { ..., SaveCheckpoint, OperationLogEntry } from "@/types";
```

Updated/new function implementations:
```ts
createSaveCheckpoint: (projectId: string, source: string, emulator: string): Promise<SaveCheckpoint> =>
  invoke<SaveCheckpoint>("create_save_checkpoint", { projectId, source, emulator }),

createMigrationPlan: (projectId: string, source: string, destination: string, emulator: string): Promise<MigrationPlan> =>
  invoke<MigrationPlan>("create_migration_plan", { projectId, source, destination, emulator }),

getCheckpoints: (projectId: string): Promise<SaveCheckpoint[]> =>
  invoke<SaveCheckpoint[]>("get_checkpoints", { projectId }),   // new

getOperationLog: (projectId: string): Promise<OperationLogEntry[]> =>
  invoke<OperationLogEntry[]>("get_operation_log", { projectId }),
```

Note: remove the existing `executeMigration` line from `ipc.ts` entirely. The old signature (`(plan: MigrationPlan) => invoke<void>("execute_migration", { plan })`) is missing `projectId` and would silently omit it if called against the updated Rust command. Since the button is always disabled this phase and no code path calls `executeMigration`, removing the wrapper is the correct action.

**`src/types/index.ts`:**
- `SaveRoot` gains `expectedDestination?: string`
- `SaveCheckpoint` gains `projectId: string`
- `MigrationBlocker` type (matches Rust enum snake_case variants):
  ```ts
  export type MigrationBlocker =
    | "no_active_project"
    | "checkpoint_required"
    | "plan_required"
    | "conflict_detected";
  ```
- `OperationLogEntry` interface added:
  ```ts
  export interface OperationLogEntry {
    id:             string;
    projectId:      string;
    operation:      string;
    description:    string;
    affectedPaths:  string[];
    reversible:     boolean;
    rolledBack:     boolean;
    createdAt:      string;
  }
  ```

**`src/lib/ipc.mock.ts`:** Updated mock signatures and fixtures to match:

```ts
createSaveCheckpoint: async (
  _projectId: string,
  _source: string,
  _emulator: string,
): Promise<SaveCheckpoint> => ({
  id: "mock-checkpoint-1",
  projectId: _projectId,
  emulator: _emulator,
  sourcePath: _source,
  archivePath: "/mock/checkpoints/mock-checkpoint-1.zip",
  createdAt: new Date().toISOString(),
  fileCount: 3,
  sizeBytes: 12288,
}),

createMigrationPlan: async (
  _projectId: string,
  _source: string,
  _destination: string,
  _emulator: string,
): Promise<MigrationPlan> => FIXTURE_MIGRATION_PLAN,

getCheckpoints: async (_projectId: string): Promise<SaveCheckpoint[]> => [],

getOperationLog: async (_projectId: string): Promise<OperationLogEntry[]> => [],
```

`FIXTURE_SAVE_ROOTS` must include `expectedDestination` on at least one entry with `migrationState: "migration_needed"`, so that mock-based tests of the plan flow can exercise `SaveRootCard.onMigrate` without hitting the `if (!root.expectedDestination) return` hard stop:

```ts
// Example fixture update:
{
  path: "/home/user/saves/duckstation",
  emulator: "duckstation",
  isSymlink: false,
  fileCount: 12,
  sizeBytes: 65536,
  migrationState: "migration_needed",
  expectedDestination: "/home/user/.local/share/duckstation/memcards",  // ← new
}
```

---

## Testing Requirements

### Rust tests

**`src-tauri/src/db/checkpoints.rs`** — `#[cfg(test)]` block using the `init_test_db()` pattern from `db/projects.rs` (creates a `TempDir`, initializes a fresh DB, stores path in `DB` static):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    #[test]
    fn checkpoint_round_trip() {
        let _dir = init_test_db();
        // insert a SaveCheckpoint, then list by project_id, assert returned
    }
}
```

**`src-tauri/src/db/operation_log.rs`** — same `init_test_db()` pattern:

```rust
#[cfg(test)]
mod tests {
    // insert an OperationLogEntry, list by project_id, assert returned
    // verify mark_rolled_back flips the flag
}
```

### Frontend tests

At least one Vitest unit test in `src/components/saves/SavesScreen.test.tsx` (or adjacent test file) covering:
- `SavesScreen` renders blocked state (`!activeProject`) — no scan triggers, no inputs rendered
- Disabled execute path — "Execute Migration" button is not present or is always disabled

### Verification commands

All tests must pass under:
- `cargo test` — Rust unit tests
- `pnpm test --run` — Vitest frontend tests
- `npx tsc --noEmit` — TypeScript type check
- `cargo check` — Rust type check

---

## Non-Goals

- No new screens
- No full rollback execution
- No export or preview expansion
- No UI polish beyond what is required for honest states
- No file movement in `execute_migration` (Phase 4 execution intentionally deferred)
