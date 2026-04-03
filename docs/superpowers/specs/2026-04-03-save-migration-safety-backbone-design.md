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

**`src-tauri/src/db/mod.rs`** — extend the `PRAGMA user_version` gate:

```rust
if version < 4 {
    conn.execute_batch(include_str!("migrations/004_save_indexes.sql"))?;
    conn.execute_batch("PRAGMA user_version = 4")?;
}
```

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

**`db::checkpoints` (new):**
- `insert(checkpoint: &SaveCheckpoint) -> Result<()>` — validates `project_id` non-empty, returns `Err` otherwise
- `list(project_id: &str) -> Result<Vec<SaveCheckpoint>>` — filters out rows where DB `project_id` is NULL (defensive read)
- `get(id: &str) -> Result<SaveCheckpoint>`

**`db::operation_log` (new):**
- `insert(entry: &OperationLogEntry) -> Result<()>` — validates `project_id` non-empty
- `list(project_id: &str) -> Result<Vec<OperationLogEntry>>` — filters out NULL `project_id` rows
- `mark_rolled_back(id: &str) -> Result<()>` — sets `rolled_back = 1`

**Validation policy:** Empty `project_id` returns `Err("project_id is required".to_string())` — no panic.

**Defensive reads:** Rows where `project_id` IS NULL are silently filtered from list results. This handles any legacy rows written before this spec; no migration is needed to clean them up.

---

## Section 2: Engine Layer

### `engine::save_checkpoint` (new module)

Pure Rust — no Tauri or DB dependencies. Archive-creation logic only.

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

**New dependency:** `zip` crate added to `Cargo.toml`.

**`engine/mod.rs`:** adds `pub mod save_checkpoint`.

### `engine::save_registry` — `expected_destination` fix

`discover_save_roots` fills `expected_destination` for applicable states:

```rust
let expected_destination = match migration_state {
    SaveMigrationState::MigrationNeeded | SaveMigrationState::ConflictDetected =>
        Some(frontend_root.join(&rule.new_path_pattern)
             .to_string_lossy().to_string()),
    _ => None,
};
```

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
4. Open a DB transaction and execute both:
   - `db::checkpoints::insert(&checkpoint)`
   - `db::operation_log::insert(&log_entry)` where `log_entry.operation = "create_checkpoint"`, `affected_paths = [source, archive_path]`, `reversible = false`
5. Commit transaction. If commit fails: delete the created archive file, return `Err`
6. Return `Ok(checkpoint)`

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

Calls `db::checkpoints::list(project_id)`.

**`execute_migration`** — structured precondition check:

```rust
pub async fn execute_migration(
    project_id: String,
    _plan: MigrationPlan,
) -> Result<(), MigrationBlocker>
```

Returns `Err(MigrationBlocker::CheckpointRequired)` (or other applicable variant) — no file movement. The frontend matches on the error variant to show the correct disabled-state label.

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

Registers new `get_checkpoints` command. Updates signatures for `create_save_checkpoint` and `create_migration_plan`.

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
- `createSaveCheckpoint(projectId, source, emulator)`
- `createMigrationPlan(projectId, source, destination, emulator)`
- `getCheckpoints(projectId): Promise<SaveCheckpoint[]>` — new
- `getOperationLog` return type: `Promise<OperationLogEntry[]>`

**`src/types/index.ts`:**
- `SaveRoot` gains `expectedDestination?: string`
- `SaveCheckpoint` gains `projectId: string`
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

**`src/lib/ipc.mock.ts`:** Updated mock signatures and fixtures to match.

---

## Testing Requirements

- At least one Rust test for checkpoint persistence (create + insert + list round-trip)
- At least one Rust test for operation log persistence (insert + list)
- At least one frontend unit test covering `SavesScreen` blocked state (`!activeProject`) or disabled execution path
- All tests in: `cargo test`, `pnpm test --run`, `npx tsc --noEmit`, `cargo check`

---

## Non-Goals

- No new screens
- No full rollback execution
- No export or preview expansion
- No UI polish beyond what is required for honest states
- No file movement in `execute_migration` (Phase 4 execution intentionally deferred)
