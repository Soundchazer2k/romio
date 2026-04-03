# Save Migration Safety Backbone Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all stub implementations in the save migration flow with real, tested code: genuine zip checkpoints, persistent operation log, correct destination paths, and a project-gated UI.

**Architecture:** Pure engine module creates zip archives with atomic failure cleanup. Two new DB modules (`db::checkpoints`, `db::operation_log`) write atomically via a new `with_transaction` helper. Commands wire engine + DB together; the frontend gains an `activeProject` guard, correct destination paths from `expectedDestination`, and a checkpoint step in the migration modal.

**Tech Stack:** Rust / Tauri v2, rusqlite 0.31, zip 2, walkdir 2, React 18 / TypeScript 5, Vitest, TanStack Query v5, Zustand

---

## Chunk 1: Rust Foundation — Models, DB Infrastructure, DB Modules

### Task 1: Add zip crate dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add zip to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `# Filesystem traversal` walkdir line:

```toml
# Zip archive creation for save checkpoints
zip = "2"
```

- [ ] **Step 2: Verify it resolves**

```bash
cd src-tauri && cargo check 2>&1 | head -20
```

Expected: no errors (zip downloads and resolves).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add zip = \"2\" for save checkpoint archives"
```

---

### Task 2: Update Rust models — save.rs

**Files:**
- Modify: `src-tauri/src/models/save.rs`

Three changes: (a) `SaveCheckpoint` gains `project_id`, (b) `SaveRoot` gains `expected_destination`, (c) new `MigrationBlocker` enum.

- [ ] **Step 1: Add `project_id` to `SaveCheckpoint`**

In `src-tauri/src/models/save.rs`, replace the `SaveCheckpoint` struct (lines 77–87):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckpoint {
    pub id:           String,
    pub project_id:   String,
    pub emulator:     String,
    pub source_path:  String,
    pub archive_path: String,
    pub created_at:   DateTime<Utc>,
    pub file_count:   u64,
    pub size_bytes:   u64,
}
```

- [ ] **Step 2: Add `expected_destination` to `SaveRoot`**

Replace the `SaveRoot` struct (lines 20–30):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRoot {
    pub path:                 String,
    pub emulator:             String,
    pub is_symlink:           bool,
    pub real_path:            Option<String>,
    pub file_count:           u64,
    pub size_bytes:           u64,
    pub migration_state:      SaveMigrationState,
    pub expected_destination: Option<String>,
}
```

- [ ] **Step 3: Add `MigrationBlocker` enum**

At the end of `src-tauri/src/models/save.rs`, add:

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

- [ ] **Step 4: Run cargo check**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: **clean pass**. The existing `commands/save.rs` stub returns `Err(...)` and never constructs a `SaveCheckpoint` struct literal, so adding `project_id` to the model does not break any existing code.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models/save.rs
git commit -m "feat(models): add project_id to SaveCheckpoint, expected_destination to SaveRoot, MigrationBlocker enum"
```

---

### Task 3: Update Rust models — validation.rs

**Files:**
- Modify: `src-tauri/src/models/validation.rs`

- [ ] **Step 1: Add `project_id` to `OperationLogEntry`**

In `src-tauri/src/models/validation.rs`, replace the `OperationLogEntry` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntry {
    pub id:             Uuid,
    pub project_id:     String,
    pub operation:      String,
    pub description:    String,
    pub affected_paths: Vec<String>,
    pub reversible:     bool,
    pub rolled_back:    bool,
    pub created_at:     DateTime<Utc>,
}
```

- [ ] **Step 2: Run cargo check**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: clean (the existing `Ok(vec![])` in `rollback.rs` doesn't construct an `OperationLogEntry`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/models/validation.rs
git commit -m "feat(models): add project_id to OperationLogEntry"
```

---

### Task 4: DB infrastructure — migration 004 + db/mod.rs

**Files:**
- Create: `src-tauri/src/db/migrations/004_save_indexes.sql`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create migration 004 SQL**

Create `src-tauri/src/db/migrations/004_save_indexes.sql`:

```sql
-- Add per-project indexes for save_checkpoints and operation_log.
-- Both tables were created in 001_initial.sql but lacked these indexes.
CREATE INDEX IF NOT EXISTS idx_save_checkpoints_project ON save_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_project    ON operation_log(project_id);
```

- [ ] **Step 2: Update db/mod.rs — add module declarations**

In `src-tauri/src/db/mod.rs`, after the existing `pub mod artifacts;` line, add:

```rust
pub mod checkpoints;
pub mod operation_log;
```

- [ ] **Step 3: Add migration 004 gate to run_migrations**

In `src-tauri/src/db/mod.rs`, inside `fn run_migrations`, after the `if version < 3` block (before the final `Ok(())`), add:

```rust
    if version < 4 {
        conn.execute_batch(include_str!("migrations/004_save_indexes.sql"))?;
        conn.execute_batch("PRAGMA user_version = 4")?;
    }
```

- [ ] **Step 4: Add with_transaction helper**

In `src-tauri/src/db/mod.rs`, after the `with_conn` function, add:

```rust
/// Opens a rusqlite transaction and passes it to `f`.
/// Commits on Ok; rolls back automatically on Err (Transaction drop).
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

- [ ] **Step 5: Verify the compile error (expected)**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: **compile error** `error[E0583]: file not found for module 'checkpoints'` and similar for `operation_log`. This is intentional — the module declarations in `db/mod.rs` reference files that don't exist yet. The repo will not compile after this commit and will be restored to a compiling state after Tasks 5 and 6 create those files.

- [ ] **Step 6: Commit the infra pieces**

```bash
git add src-tauri/src/db/migrations/004_save_indexes.sql src-tauri/src/db/mod.rs
git commit -m "feat(db): migration 004 indexes, with_transaction helper, new module declarations"
```

---

### Task 5: db::checkpoints (TDD)

**Files:**
- Create: `src-tauri/src/db/checkpoints.rs`

- [ ] **Step 1: Write the failing test first**

Create `src-tauri/src/db/checkpoints.rs` with only the test module (implementation stubs to follow):

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use crate::models::save::SaveCheckpoint;

pub fn insert(_checkpoint: &SaveCheckpoint) -> Result<()> {
    todo!()
}

pub fn insert_tx(_tx: &rusqlite::Transaction, _checkpoint: &SaveCheckpoint) -> Result<()> {
    todo!()
}

pub fn list(_project_id: &str) -> Result<Vec<SaveCheckpoint>> {
    todo!()
}

pub fn get(_id: &str) -> Result<SaveCheckpoint> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_checkpoint(project_id: &str) -> SaveCheckpoint {
        SaveCheckpoint {
            id:           uuid::Uuid::new_v4().to_string(),
            project_id:   project_id.to_string(),
            emulator:     "duckstation".to_string(),
            source_path:  "/saves/duckstation".to_string(),
            archive_path: "/checkpoints/test.zip".to_string(),
            created_at:   Utc::now(),
            file_count:   3,
            size_bytes:   12288,
        }
    }

    #[test]
    fn checkpoint_round_trip() {
        let _dir = init_test_db();
        let cp = make_checkpoint("proj-1");
        insert(&cp).unwrap();
        let results = list("proj-1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, cp.id);
        assert_eq!(results[0].project_id, "proj-1");
        assert_eq!(results[0].file_count, 3);
        assert_eq!(results[0].size_bytes, 12288);
    }

    #[test]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        insert(&make_checkpoint("proj-a")).unwrap();
        insert(&make_checkpoint("proj-b")).unwrap();
        let a = list("proj-a").unwrap();
        let b = list("proj-b").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].project_id, "proj-a");
        assert_eq!(b[0].project_id, "proj-b");
    }

    #[test]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut cp = make_checkpoint("x");
        cp.project_id = "".to_string();
        assert!(insert(&cp).is_err());
    }
}
```

- [ ] **Step 2: Run tests — expect failures (todo! panics)**

```bash
cd src-tauri && cargo test db::checkpoints 2>&1
```

Expected: tests run but panic on `todo!()`.

- [ ] **Step 3: Implement the functions**

Replace **only the four stub functions** at the top of `src-tauri/src/db/checkpoints.rs` with the full implementations below. The `#[cfg(test)]` block at the bottom of the file stays exactly as written in Step 1 — do not modify it.

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use crate::models::save::SaveCheckpoint;

pub fn insert(checkpoint: &SaveCheckpoint) -> Result<()> {
    if checkpoint.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO save_checkpoints
             (id, project_id, emulator, source_path, archive_path, file_count, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                checkpoint.id,
                checkpoint.project_id,
                checkpoint.emulator,
                checkpoint.source_path,
                checkpoint.archive_path,
                checkpoint.file_count as i64,
                checkpoint.size_bytes as i64,
                checkpoint.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

pub fn insert_tx(tx: &rusqlite::Transaction, checkpoint: &SaveCheckpoint) -> Result<()> {
    if checkpoint.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    tx.execute(
        "INSERT INTO save_checkpoints
         (id, project_id, emulator, source_path, archive_path, file_count, size_bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            checkpoint.id,
            checkpoint.project_id,
            checkpoint.emulator,
            checkpoint.source_path,
            checkpoint.archive_path,
            checkpoint.file_count as i64,
            checkpoint.size_bytes as i64,
            checkpoint.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn list(project_id: &str) -> Result<Vec<SaveCheckpoint>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, emulator, source_path, archive_path,
                    file_count, size_bytes, created_at
             FROM save_checkpoints
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let mut rows = stmt.query(params![project_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String              = row.get(0)?;
            let pid: Option<String>     = row.get(1)?;
            let Some(project_id) = pid else {
                eprintln!("[db::checkpoints] skipping row with NULL project_id, id={:?}", id);
                continue;
            };
            let created_at_str: String  = row.get(7)?;
            let created_at = match DateTime::parse_from_rfc3339(&created_at_str) {
                Ok(dt) => dt.with_timezone(&chrono::Utc),
                Err(e) => {
                    eprintln!("[db::checkpoints] skipping row with malformed created_at {:?}: {}", created_at_str, e);
                    continue;
                }
            };
            out.push(SaveCheckpoint {
                id,
                project_id,
                emulator:     row.get(2)?,
                source_path:  row.get(3)?,
                archive_path: row.get(4)?,
                file_count:   row.get::<_, i64>(5)? as u64,
                size_bytes:   row.get::<_, i64>(6)? as u64,
                created_at,
            });
        }
        Ok(out)
    })
}

pub fn get(id: &str) -> Result<SaveCheckpoint> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, emulator, source_path, archive_path,
                    file_count, size_bytes, created_at
             FROM save_checkpoints WHERE id = ?1",
        )?;
        let row = stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;
        let (id, pid, emulator, source_path, archive_path, file_count, size_bytes, created_at_str) = row;
        let project_id = pid.ok_or_else(|| anyhow!("checkpoint {} has NULL project_id", id))?;
        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .map_err(|e| anyhow!("malformed created_at {:?}: {}", created_at_str, e))?;
        Ok(SaveCheckpoint {
            id,
            project_id,
            emulator,
            source_path,
            archive_path,
            file_count: file_count as u64,
            size_bytes: size_bytes as u64,
            created_at,
        })
    })
}

```

Paste the `#[cfg(test)]` block from Step 1 at the bottom of the file. The complete closing of the file is:

```rust
// ... (4 public functions above) ...

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_checkpoint(project_id: &str) -> SaveCheckpoint {
        SaveCheckpoint {
            id:           uuid::Uuid::new_v4().to_string(),
            project_id:   project_id.to_string(),
            emulator:     "duckstation".to_string(),
            source_path:  "/saves/duckstation".to_string(),
            archive_path: "/checkpoints/test.zip".to_string(),
            created_at:   Utc::now(),
            file_count:   3,
            size_bytes:   12288,
        }
    }

    #[test]
    fn checkpoint_round_trip() {
        let _dir = init_test_db();
        let cp = make_checkpoint("proj-1");
        insert(&cp).unwrap();
        let results = list("proj-1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, cp.id);
        assert_eq!(results[0].project_id, "proj-1");
        assert_eq!(results[0].file_count, 3);
        assert_eq!(results[0].size_bytes, 12288);
    }

    #[test]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        insert(&make_checkpoint("proj-a")).unwrap();
        insert(&make_checkpoint("proj-b")).unwrap();
        let a = list("proj-a").unwrap();
        let b = list("proj-b").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].project_id, "proj-a");
        assert_eq!(b[0].project_id, "proj-b");
    }

    #[test]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut cp = make_checkpoint("x");
        cp.project_id = "".to_string();
        assert!(insert(&cp).is_err());
    }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd src-tauri && cargo test db::checkpoints 2>&1
```

Expected output: `test db::checkpoints::tests::checkpoint_round_trip ... ok`, `test db::checkpoints::tests::list_filters_by_project_id ... ok`, `test db::checkpoints::tests::insert_rejects_empty_project_id ... ok`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/checkpoints.rs
git commit -m "feat(db): db::checkpoints module with insert/insert_tx/list/get and round-trip tests"
```

---

### Task 6: db::operation_log (TDD)

**Files:**
- Create: `src-tauri/src/db/operation_log.rs`

- [ ] **Step 1: Write the failing test first**

Create `src-tauri/src/db/operation_log.rs` with stubs and tests:

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use uuid::Uuid;
use crate::models::validation::OperationLogEntry;

pub fn insert(_entry: &OperationLogEntry) -> Result<()> {
    todo!()
}

pub fn insert_tx(_tx: &rusqlite::Transaction, _entry: &OperationLogEntry) -> Result<()> {
    todo!()
}

pub fn list(_project_id: &str) -> Result<Vec<OperationLogEntry>> {
    todo!()
}

pub fn mark_rolled_back(_id: &str) -> Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_entry(project_id: &str) -> OperationLogEntry {
        OperationLogEntry {
            id:             Uuid::new_v4(),
            project_id:     project_id.to_string(),
            operation:      "create_checkpoint".to_string(),
            description:    "Test checkpoint".to_string(),
            affected_paths: vec!["/saves/test".to_string(), "/checkpoints/test.zip".to_string()],
            reversible:     false,
            rolled_back:    false,
            created_at:     Utc::now(),
        }
    }

    #[test]
    fn operation_log_round_trip() {
        let _dir = init_test_db();
        let entry = make_entry("proj-1");
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        let results = list("proj-1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.to_string(), id_str);
        assert_eq!(results[0].project_id, "proj-1");
        assert_eq!(results[0].operation, "create_checkpoint");
        assert_eq!(results[0].affected_paths.len(), 2);
        assert!(!results[0].rolled_back);
    }

    #[test]
    fn mark_rolled_back_flips_flag() {
        let _dir = init_test_db();
        let entry = make_entry("proj-1");
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        mark_rolled_back(&id_str).unwrap();
        let results = list("proj-1").unwrap();
        assert!(results[0].rolled_back);
    }

    #[test]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        insert(&make_entry("proj-a")).unwrap();
        insert(&make_entry("proj-b")).unwrap();
        let a = list("proj-a").unwrap();
        let b = list("proj-b").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut e = make_entry("x");
        e.project_id = "".to_string();
        assert!(insert(&e).is_err());
    }
}
```

- [ ] **Step 2: Run tests — expect panics from todo!()**

```bash
cd src-tauri && cargo test db::operation_log 2>&1
```

Expected: tests run but panic on `todo!()`.

- [ ] **Step 3: Implement the functions**

Replace the stub functions in `src-tauri/src/db/operation_log.rs`:

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::DateTime;
use rusqlite::params;
use uuid::Uuid;
use crate::models::validation::OperationLogEntry;

pub fn insert(entry: &OperationLogEntry) -> Result<()> {
    if entry.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO operation_log
             (id, project_id, operation, description, affected_paths, reversible, rolled_back, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id.to_string(),
                entry.project_id,
                entry.operation,
                entry.description,
                serde_json::to_string(&entry.affected_paths)?,
                entry.reversible as i32,
                entry.rolled_back as i32,
                entry.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

pub fn insert_tx(tx: &rusqlite::Transaction, entry: &OperationLogEntry) -> Result<()> {
    if entry.project_id.is_empty() {
        return Err(anyhow!("project_id is required"));
    }
    tx.execute(
        "INSERT INTO operation_log
         (id, project_id, operation, description, affected_paths, reversible, rolled_back, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id.to_string(),
            entry.project_id,
            entry.operation,
            entry.description,
            serde_json::to_string(&entry.affected_paths)?,
            entry.reversible as i32,
            entry.rolled_back as i32,
            entry.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn list(project_id: &str) -> Result<Vec<OperationLogEntry>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, operation, description, affected_paths,
                    reversible, rolled_back, created_at
             FROM operation_log
             WHERE project_id = ?1
             ORDER BY created_at DESC",
        )?;
        let mut rows = stmt.query(params![project_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let id_str: String          = row.get(0)?;
            let id = match Uuid::parse_str(&id_str) {
                Ok(u)  => u,
                Err(e) => {
                    eprintln!("[db::operation_log] skipping row with malformed id {:?}: {}", id_str, e);
                    continue;
                }
            };
            let pid: Option<String>     = row.get(1)?;
            let Some(project_id) = pid else {
                eprintln!("[db::operation_log] skipping row with NULL project_id, id={:?}", id_str);
                continue;
            };
            let paths_json: String      = row.get(4)?;
            let affected_paths: Vec<String> = serde_json::from_str(&paths_json).unwrap_or_default();
            let created_at_str: String  = row.get(7)?;
            let created_at = match DateTime::parse_from_rfc3339(&created_at_str) {
                Ok(dt) => dt.with_timezone(&chrono::Utc),
                Err(e) => {
                    eprintln!("[db::operation_log] skipping row with malformed created_at {:?}: {}", created_at_str, e);
                    continue;
                }
            };
            out.push(OperationLogEntry {
                id,
                project_id,
                operation:      row.get(2)?,
                description:    row.get(3)?,
                affected_paths,
                reversible:     row.get::<_, i32>(5)? != 0,
                rolled_back:    row.get::<_, i32>(6)? != 0,
                created_at,
            });
        }
        Ok(out)
    })
}

pub fn mark_rolled_back(id: &str) -> Result<()> {
    crate::db::with_conn(|conn| {
        let rows = conn.execute(
            "UPDATE operation_log SET rolled_back = 1 WHERE id = ?1",
            params![id],
        )?;
        if rows == 0 {
            return Err(anyhow!("operation log entry not found: {}", id));
        }
        Ok(())
    })
}

```

Paste the `#[cfg(test)]` block from Step 1 at the bottom of the file. The complete closing of the file is:

```rust
// ... (4 public functions above) ...

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::TempDir;

    fn init_test_db() -> TempDir {
        let dir = TempDir::new().unwrap();
        crate::db::init(dir.path()).unwrap();
        dir
    }

    fn make_entry(project_id: &str) -> OperationLogEntry {
        OperationLogEntry {
            id:             Uuid::new_v4(),
            project_id:     project_id.to_string(),
            operation:      "create_checkpoint".to_string(),
            description:    "Test checkpoint".to_string(),
            affected_paths: vec!["/saves/test".to_string(), "/checkpoints/test.zip".to_string()],
            reversible:     false,
            rolled_back:    false,
            created_at:     Utc::now(),
        }
    }

    #[test]
    fn operation_log_round_trip() {
        let _dir = init_test_db();
        let entry = make_entry("proj-1");
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        let results = list("proj-1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.to_string(), id_str);
        assert_eq!(results[0].project_id, "proj-1");
        assert_eq!(results[0].operation, "create_checkpoint");
        assert_eq!(results[0].affected_paths.len(), 2);
        assert!(!results[0].rolled_back);
    }

    #[test]
    fn mark_rolled_back_flips_flag() {
        let _dir = init_test_db();
        let entry = make_entry("proj-1");
        let id_str = entry.id.to_string();
        insert(&entry).unwrap();
        mark_rolled_back(&id_str).unwrap();
        let results = list("proj-1").unwrap();
        assert!(results[0].rolled_back);
    }

    #[test]
    fn list_filters_by_project_id() {
        let _dir = init_test_db();
        insert(&make_entry("proj-a")).unwrap();
        insert(&make_entry("proj-b")).unwrap();
        let a = list("proj-a").unwrap();
        let b = list("proj-b").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn insert_rejects_empty_project_id() {
        let _dir = init_test_db();
        let mut e = make_entry("x");
        e.project_id = "".to_string();
        assert!(insert(&e).is_err());
    }
}
```

- [ ] **Step 4: Run tests — all must pass**

```bash
cd src-tauri && cargo test db::operation_log 2>&1
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run full cargo test to confirm nothing regressed**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/operation_log.rs
git commit -m "feat(db): db::operation_log module with insert/list/mark_rolled_back and tests"
```

---

## Chunk 2: Engine, Commands, Frontend

### Task 7: engine::save_checkpoint (TDD)

**Files:**
- Create: `src-tauri/src/engine/save_checkpoint.rs`
- Modify: `src-tauri/src/engine/mod.rs`

- [ ] **Step 1: Add module declaration to engine/mod.rs**

In `src-tauri/src/engine/mod.rs`, add at the end:

```rust
pub mod save_checkpoint;
```

- [ ] **Step 2: Write the failing test first**

Create `src-tauri/src/engine/save_checkpoint.rs` with stubs and tests:

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::{anyhow, Result};
use chrono::Utc;
use std::fs;
use std::path::Path;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use crate::models::save::SaveCheckpoint;

pub fn create_checkpoint(
    project_id:   &str,
    source:       &Path,
    emulator:     &str,
    app_data_dir: &Path,
) -> Result<SaveCheckpoint> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_source_dir(dir: &TempDir) -> std::path::PathBuf {
        let saves = dir.path().join("saves");
        fs::create_dir_all(saves.join("memcards")).unwrap();
        fs::write(saves.join("memcards/mc0.mc"),   b"save data").unwrap();
        fs::write(saves.join("memcards/mc1.mc"),   b"save data 2").unwrap();
        fs::write(saves.join("state.savestate"),   b"state").unwrap();
        saves
    }

    #[test]
    fn creates_zip_with_correct_metadata() {
        let tmp = TempDir::new().unwrap();
        let source = make_source_dir(&tmp);
        let app_dir = TempDir::new().unwrap();

        let checkpoint = create_checkpoint(
            "proj-1",
            &source,
            "duckstation",
            app_dir.path(),
        ).unwrap();

        assert_eq!(checkpoint.project_id, "proj-1");
        assert_eq!(checkpoint.emulator, "duckstation");
        assert_eq!(checkpoint.file_count, 3);
        assert!(checkpoint.size_bytes > 0);
        assert!(std::path::Path::new(&checkpoint.archive_path).exists(),
            "archive file must exist at {}", checkpoint.archive_path);
    }

    #[test]
    fn archive_entries_have_no_leading_slash() {
        let tmp = TempDir::new().unwrap();
        let source = make_source_dir(&tmp);
        let app_dir = TempDir::new().unwrap();

        let checkpoint = create_checkpoint(
            "proj-1",
            &source,
            "duckstation",
            app_dir.path(),
        ).unwrap();

        let file = fs::File::open(&checkpoint.archive_path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        for i in 0..zip.len() {
            let entry = zip.by_index(i).unwrap();
            assert!(!entry.name().starts_with('/'),
                "entry {:?} must not have a leading slash", entry.name());
        }
    }

    #[test]
    fn fails_if_source_does_not_exist() {
        let app_dir = TempDir::new().unwrap();
        let result = create_checkpoint(
            "proj-1",
            Path::new("/nonexistent/path"),
            "duckstation",
            app_dir.path(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn cleans_up_partial_zip_on_failure() {
        // This is hard to test without mocking I/O; instead verify no .zip
        // files are left behind after a failed source path call.
        let app_dir = TempDir::new().unwrap();
        let _ = create_checkpoint(
            "proj-1",
            Path::new("/nonexistent/path"),
            "duckstation",
            app_dir.path(),
        );
        let checkpoints_dir = app_dir.path().join("checkpoints");
        if checkpoints_dir.exists() {
            let zips: Vec<_> = fs::read_dir(&checkpoints_dir).unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "zip").unwrap_or(false))
                .collect();
            assert!(zips.is_empty(), "no partial zips should remain after failure");
        }
    }
}
```

- [ ] **Step 3: Run tests — expect panics from todo!()**

```bash
cd src-tauri && cargo test engine::save_checkpoint 2>&1
```

Expected: tests run but panic on `todo!()`.

- [ ] **Step 4: Implement create_checkpoint**

Replace the `create_checkpoint` stub in `src-tauri/src/engine/save_checkpoint.rs`:

```rust
pub fn create_checkpoint(
    project_id:   &str,
    source:       &Path,
    emulator:     &str,
    app_data_dir: &Path,
) -> Result<SaveCheckpoint> {
    if !source.exists() || !source.is_dir() {
        return Err(anyhow!(
            "source path does not exist or is not a directory: {}",
            source.display()
        ));
    }

    let checkpoints_dir = app_data_dir.join("checkpoints");
    fs::create_dir_all(&checkpoints_dir)?;

    let archive_id   = Uuid::new_v4().to_string();
    let archive_path = checkpoints_dir.join(format!("{}.zip", archive_id));

    match create_zip(source, &archive_path) {
        Ok((file_count, size_bytes)) => Ok(SaveCheckpoint {
            id:           archive_id,
            project_id:   project_id.to_string(),
            emulator:     emulator.to_string(),
            source_path:  source.to_string_lossy().to_string(),
            archive_path: archive_path.to_string_lossy().to_string(),
            created_at:   Utc::now(),
            file_count,
            size_bytes,
        }),
        Err(e) => {
            // Atomic cleanup: delete partial archive before returning error
            if archive_path.exists() {
                let _ = fs::remove_file(&archive_path);
            }
            Err(e)
        }
    }
}

fn create_zip(source: &Path, archive_path: &Path) -> Result<(u64, u64)> {
    let file    = fs::File::create(archive_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut file_count = 0u64;
    let mut size_bytes = 0u64;

    for entry in WalkDir::new(source).into_iter() {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path     = entry.path();
        let relative = path.strip_prefix(source)
            .map_err(|e| anyhow!("failed to relativize path {}: {}", path.display(), e))?;

        // Normalize separator to forward slash; never a leading slash
        let name: String = relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");

        let metadata  = entry.metadata()?;
        size_bytes    += metadata.len();
        file_count    += 1;

        zip.start_file(&name, options)?;
        let mut f = fs::File::open(path)?;
        std::io::copy(&mut f, &mut zip)?;
    }

    zip.finish()?;
    Ok((file_count, size_bytes))
}
```

- [ ] **Step 5: Run tests — all must pass**

```bash
cd src-tauri && cargo test engine::save_checkpoint 2>&1
```

Expected: all 4 tests pass. Note: `cleans_up_partial_zip_on_failure` passes because no checkpoints dir is created before the error.

- [ ] **Step 6: Run full cargo test**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/engine/save_checkpoint.rs src-tauri/src/engine/mod.rs
git commit -m "feat(engine): save_checkpoint module — real zip archive creation with atomic failure cleanup"
```

---

### Task 8: engine::save_registry — expected_destination fix

**Files:**
- Modify: `src-tauri/src/engine/save_registry.rs`

- [ ] **Step 1: Replace the roots.push block**

In `src-tauri/src/engine/save_registry.rs`, replace lines 47–55 (the existing `roots.push(SaveRoot { ... })` block):

**Before:**
```rust
            roots.push(SaveRoot {
                path: active_path.to_string_lossy().to_string(),
                emulator: rule.emulator.clone(),
                is_symlink: symlink,
                real_path: real.map(|p| p.to_string_lossy().to_string()),
                file_count: stats.0,
                size_bytes: stats.1,
                migration_state,
            });
```

**After:**
```rust
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

> **Note:** The `migration_state` match arm borrows it by value. Because `SaveMigrationState` derives `Clone + PartialEq`, and `migration_state` is moved into the struct field above, you need to reference the match against the field already set. Change to this pattern to avoid the use-after-move:

```rust
            let expected_destination = match &migration_state {
                SaveMigrationState::MigrationNeeded | SaveMigrationState::ConflictDetected =>
                    Some(new_path.to_string_lossy().to_string()),
                _ => None,
            };
            roots.push(SaveRoot {
                path:                 active_path.to_string_lossy().to_string(),
                emulator:             rule.emulator.clone(),
                is_symlink:           symlink,
                real_path:            real.map(|p| p.to_string_lossy().to_string()),
                file_count:           stats.0,
                size_bytes:           stats.1,
                migration_state,
                expected_destination,
            });
```

- [ ] **Step 2: Run cargo check**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/engine/save_registry.rs
git commit -m "fix(engine): fill expected_destination in discover_save_roots from rule.new_path_pattern"
```

---

### Task 9: commands::save — real implementation

**Files:**
- Modify: `src-tauri/src/commands/save.rs`

- [ ] **Step 1: Rewrite commands/save.rs**

Replace the entire contents of `src-tauri/src/commands/save.rs`:

```rust
// SPDX-License-Identifier: GPL-3.0
use chrono::Utc;
use uuid::Uuid;
use crate::models::save::{MigrationBlocker, MigrationPlan, SaveCheckpoint, SaveRoot};
use crate::models::validation::OperationLogEntry;

#[tauri::command]
pub async fn discover_save_roots(frontend_root: String) -> Result<Vec<SaveRoot>, String> {
    let rules = crate::db::save::load_rules().map_err(|e| e.to_string())?;
    Ok(crate::engine::save_registry::discover_save_roots(
        std::path::Path::new(&frontend_root),
        &rules,
    ))
}

#[tauri::command]
pub async fn check_migration_needed(frontend_root: String) -> Result<bool, String> {
    let roots = discover_save_roots(frontend_root).await?;
    Ok(roots
        .iter()
        .any(|r| r.migration_state == crate::models::save::SaveMigrationState::MigrationNeeded))
}

#[tauri::command]
pub async fn create_migration_plan(
    project_id:  String,
    source:      String,
    destination: String,
    emulator:    String,
) -> Result<MigrationPlan, String> {
    if project_id.is_empty() {
        return Err("project_id is required".to_string());
    }
    crate::db::projects::get(&project_id)
        .map_err(|e| format!("project not found: {e}"))?;
    crate::engine::save_registry::build_migration_plan(
        std::path::Path::new(&source),
        std::path::Path::new(&destination),
        &emulator,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_save_checkpoint(
    project_id: String,
    source:     String,
    emulator:   String,
    app_handle: tauri::AppHandle,
) -> Result<SaveCheckpoint, String> {
    if project_id.is_empty() {
        return Err("project_id is required".to_string());
    }

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;

    // Pure engine call: creates zip, returns SaveCheckpoint (no DB writes)
    let checkpoint = crate::engine::save_checkpoint::create_checkpoint(
        &project_id,
        std::path::Path::new(&source),
        &emulator,
        &app_data_dir,
    )
    .map_err(|e| e.to_string())?;

    let log_entry = OperationLogEntry {
        id:             Uuid::new_v4(),
        project_id:     project_id.clone(),
        operation:      "create_checkpoint".to_string(),
        description:    format!(
            "Created checkpoint of {} ({} files, {} bytes)",
            source, checkpoint.file_count, checkpoint.size_bytes
        ),
        affected_paths: vec![source.clone(), checkpoint.archive_path.clone()],
        reversible:     false,
        rolled_back:    false,
        created_at:     Utc::now(),
    };

    // Atomically persist checkpoint row + log entry
    let archive_path = checkpoint.archive_path.clone();
    if let Err(e) = crate::db::with_transaction(|tx| {
        crate::db::checkpoints::insert_tx(tx, &checkpoint)?;
        crate::db::operation_log::insert_tx(tx, &log_entry)?;
        Ok(())
    }) {
        // Transaction failed: delete archive so no orphan artifact exists
        let _ = std::fs::remove_file(&archive_path);
        return Err(format!("Failed to persist checkpoint: {e}"));
    }

    Ok(checkpoint)
}

#[tauri::command]
pub async fn get_checkpoints(project_id: String) -> Result<Vec<SaveCheckpoint>, String> {
    crate::db::checkpoints::list(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn execute_migration(
    _project_id: String,
    _plan:       MigrationPlan,
) -> Result<(), MigrationBlocker> {
    Err(MigrationBlocker::CheckpointRequired)
}
```

- [ ] **Step 2: Run cargo check**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/save.rs
git commit -m "feat(commands): real create_save_checkpoint, updated create_migration_plan, new get_checkpoints, gated execute_migration"
```

---

### Task 10: commands::rollback + lib.rs registration

**Files:**
- Modify: `src-tauri/src/commands/rollback.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update get_operation_log in rollback.rs**

Replace the entire contents of `src-tauri/src/commands/rollback.rs`:

```rust
// SPDX-License-Identifier: GPL-3.0
use crate::models::validation::OperationLogEntry;

#[tauri::command]
pub async fn get_operation_log(project_id: String) -> Result<Vec<OperationLogEntry>, String> {
    crate::db::operation_log::list(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollback_operation(_operation_id: String) -> Result<(), String> {
    Err("Rollback execution not yet implemented — log entry preserved".to_string())
}
```

- [ ] **Step 2: Register get_checkpoints in lib.rs**

In `src-tauri/src/lib.rs`, inside the `generate_handler![]` macro, after `commands::save::create_save_checkpoint,` add:

```rust
            commands::save::get_checkpoints,
```

The save migration section should now read:

```rust
            // Save migration
            commands::save::discover_save_roots,
            commands::save::check_migration_needed,
            commands::save::create_migration_plan,
            commands::save::execute_migration,
            commands::save::create_save_checkpoint,
            commands::save::get_checkpoints,
```

- [ ] **Step 3: Run cargo check + full cargo test**

```bash
cd src-tauri && cargo check 2>&1 && cargo test 2>&1
```

Expected: all tests pass, no compile errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/rollback.rs src-tauri/src/lib.rs
git commit -m "feat(commands): real get_operation_log, register get_checkpoints in lib.rs"
```

---

### Task 11: TypeScript types + IPC wrappers + mocks

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/ipc.mock.ts`

- [ ] **Step 1: Update src/types/index.ts**

**a) Add `expectedDestination` to `SaveRoot`** (replace the `SaveRoot` interface):

```ts
export interface SaveRoot {
  path:                 string;
  emulator:             string;
  isSymlink:            boolean;
  realPath?:            string;
  fileCount:            number;
  sizeBytes:            number;
  migrationState:       SaveMigrationState;
  expectedDestination?: string;
}
```

**b) Add `projectId` to `SaveCheckpoint`** (replace the `SaveCheckpoint` interface):

```ts
export interface SaveCheckpoint {
  id:          string;
  projectId:   string;
  emulator:    string;
  sourcePath:  string;
  archivePath: string;
  createdAt:   string;
  fileCount:   number;
  sizeBytes:   number;
}
```

**c) Add `MigrationBlocker` type** (after the `SaveCheckpoint` interface):

```ts
export type MigrationBlocker =
  | "no_active_project"
  | "checkpoint_required"
  | "plan_required"
  | "conflict_detected";
```

**d) Add `OperationLogEntry` interface** (after `MigrationBlocker`):

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

- [ ] **Step 2: Update src/lib/ipc.ts**

**a) Add `OperationLogEntry` to the import block.** Replace:
```ts
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule, BiosStatusResponse,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```
With:
```ts
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule, BiosStatusResponse,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint, OperationLogEntry,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```

**b) Replace the Save migration section** (lines 51–57). Replace:
```ts
  // Save migration
  discoverSaveRoots:   (frontendRoot: string)         => invoke<SaveRoot[]>("discover_save_roots", { frontendRoot }),
  checkMigrationNeeded:(frontendRoot: string)         => invoke<boolean>("check_migration_needed", { frontendRoot }),
  createMigrationPlan: (source: string, destination: string, emulator: string) =>
                          invoke<MigrationPlan>("create_migration_plan", { source, destination, emulator }),
  executeMigration:    (plan: MigrationPlan)          => invoke<void>("execute_migration", { plan }),
  createSaveCheckpoint:(source: string, emulator: string) =>
                          invoke<SaveCheckpoint>("create_save_checkpoint", { source, emulator }),
```
With:
```ts
  // Save migration
  discoverSaveRoots:    (frontendRoot: string)                                                     => invoke<SaveRoot[]>("discover_save_roots", { frontendRoot }),
  checkMigrationNeeded: (frontendRoot: string)                                                     => invoke<boolean>("check_migration_needed", { frontendRoot }),
  createMigrationPlan:  (projectId: string, source: string, destination: string, emulator: string) => invoke<MigrationPlan>("create_migration_plan", { projectId, source, destination, emulator }),
  createSaveCheckpoint: (projectId: string, source: string, emulator: string)                      => invoke<SaveCheckpoint>("create_save_checkpoint", { projectId, source, emulator }),
  getCheckpoints:       (projectId: string)                                                        => invoke<SaveCheckpoint[]>("get_checkpoints", { projectId }),
```

**c) Update the Rollback section** (line 84). Replace:
```ts
  getOperationLog:  (projectId: string)               => invoke("get_operation_log", { projectId }),
```
With:
```ts
  getOperationLog:  (projectId: string)               => invoke<OperationLogEntry[]>("get_operation_log", { projectId }),
```

- [ ] **Step 3: Update src/lib/ipc.mock.ts**

**a) Add `OperationLogEntry` to the import block.** Replace:
```ts
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule, BiosStatusResponse,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```
With:
```ts
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule, BiosStatusResponse,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint, OperationLogEntry,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```

**b) Update `FIXTURE_SAVE_ROOTS`** — add `expectedDestination` to the migration_needed entry:

```ts
const FIXTURE_SAVE_ROOTS: SaveRoot[] = [
  {
    path: "/home/user/.config/retroarch/saves",
    emulator: "retroarch",
    isSymlink: false,
    fileCount: 42,
    sizeBytes: 1048576,
    migrationState: "migration_needed",
    expectedDestination: "/home/user/.local/share/retroarch/saves",
  },
  {
    path: "/home/user/.config/retroarch/states",
    emulator: "retroarch",
    isSymlink: true,
    realPath: "/mnt/external/states",
    fileCount: 15,
    sizeBytes: 524288,
    migrationState: "already_migrated",
  },
];
```

**c) Replace the Save migration section in the mock `ipc` object.** Replace:
```ts
  discoverSaveRoots: async (_frontendRoot: string): Promise<SaveRoot[]> =>
    FIXTURE_SAVE_ROOTS,
  checkMigrationNeeded: async (_frontendRoot: string): Promise<boolean> =>
    true,
  createMigrationPlan: async (
    _source: string, _destination: string, _emulator: string
  ): Promise<MigrationPlan> => FIXTURE_MIGRATION_PLAN,
  executeMigration: async (_plan: MigrationPlan): Promise<void> =>
    undefined,
  createSaveCheckpoint: async (_source: string, _emulator: string): Promise<SaveCheckpoint> => ({
    id:          "mock-checkpoint-1",
    emulator:    _emulator,
    sourcePath:  _source,
    archivePath: "/tmp/checkpoint.tar.gz",
    createdAt:   "2026-03-28T00:00:00Z",
    fileCount:   42,
    sizeBytes:   1048576,
  }),
```
With:
```ts
  discoverSaveRoots:    async (_frontendRoot: string): Promise<SaveRoot[]> =>
    FIXTURE_SAVE_ROOTS,
  checkMigrationNeeded: async (_frontendRoot: string): Promise<boolean> =>
    true,
  createMigrationPlan: async (
    _projectId: string, _source: string, _destination: string, _emulator: string
  ): Promise<MigrationPlan> => FIXTURE_MIGRATION_PLAN,
  createSaveCheckpoint: async (
    _projectId: string, _source: string, _emulator: string
  ): Promise<SaveCheckpoint> => ({
    id:          "mock-checkpoint-1",
    projectId:   _projectId,
    emulator:    _emulator,
    sourcePath:  _source,
    archivePath: "/mock/checkpoints/mock-checkpoint-1.zip",
    createdAt:   new Date().toISOString(),
    fileCount:   3,
    sizeBytes:   12288,
  }),
  getCheckpoints: async (_projectId: string): Promise<SaveCheckpoint[]> => [],
```

**d) Update the Rollback section in the mock.** Replace:
```ts
  getOperationLog: async (_projectId: string) => [],
```
With:
```ts
  getOperationLog: async (_projectId: string): Promise<OperationLogEntry[]> => [],
```

- [ ] **Step 4: Run TypeScript type check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/ipc.ts src/lib/ipc.mock.ts
git commit -m "feat(frontend): add OperationLogEntry, MigrationBlocker types; update IPC wrappers with projectId"
```

---

### Task 12: SavesScreen rewrite + frontend tests

**Files:**
- Modify: `src/components/saves/SavesScreen.tsx`
- Create: `src/lib/saves.test.ts`

- [ ] **Step 1: Write the frontend test first**

Create `src/lib/saves.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0
import { describe, it, expect } from "vitest";
import type { OperationLogEntry, SaveCheckpoint, SaveRoot } from "@/types";
import { ipc } from "@/lib/ipc.mock";

describe("OperationLogEntry type contract", () => {
  it("getOperationLog mock returns typed OperationLogEntry array", async () => {
    const log: OperationLogEntry[] = await ipc.getOperationLog("proj-1");
    expect(Array.isArray(log)).toBe(true);
  });
});

describe("SaveCheckpoint type contract", () => {
  it("createSaveCheckpoint mock returns checkpoint with projectId", async () => {
    const cp: SaveCheckpoint = await ipc.createSaveCheckpoint(
      "proj-1", "/saves/test", "duckstation"
    );
    expect(cp.projectId).toBe("proj-1");
    expect(cp.id).toBeTruthy();
    expect(cp.archivePath).toContain(".zip");
  });

  it("getCheckpoints mock returns array", async () => {
    const cps: SaveCheckpoint[] = await ipc.getCheckpoints("proj-1");
    expect(Array.isArray(cps)).toBe(true);
  });
});

describe("SaveRoot.expectedDestination", () => {
  it("fixture has expectedDestination on migration_needed root", async () => {
    const roots: SaveRoot[] = await ipc.discoverSaveRoots("/fake/root");
    const atRisk = roots.filter((r) => r.migrationState === "migration_needed");
    expect(atRisk.length).toBeGreaterThan(0);
    atRisk.forEach((r) => {
      expect(r.expectedDestination).toBeTruthy();
    });
  });
});

describe("createMigrationPlan mock accepts projectId", () => {
  it("passes through to fixture plan", async () => {
    const plan = await ipc.createMigrationPlan(
      "proj-1",
      "/saves/test",
      "/saves/new",
      "retroarch"
    );
    expect(plan.sourcePath).toBeTruthy();
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — all must pass**

```bash
pnpm test --run 2>&1
```

Expected: the new tests in `saves.test.ts` all pass.

- [ ] **Step 3: Rewrite SavesScreen.tsx**

Replace the entire contents of `src/components/saves/SavesScreen.tsx`:

```tsx
// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Save, AlertTriangle, ArrowRight, ShieldCheck, Link2,
  Archive, CheckCircle2, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { SaveRoot, MigrationPlan, SaveCheckpoint, OperationLogEntry } from "@/types";
import { cn, formatBytes, migrationStateLabel } from "@/lib/utils";

// ── Screen ───────────────────────────────────────────────────────────────────

export function SavesScreen() {
  const { activeProject, setRomioState } = useAppStore();
  const queryClient = useQueryClient();
  const [frontendRoot, setFrontendRoot] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<MigrationPlan | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<SaveRoot | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);

  const projectId = activeProject?.id ?? "";

  // ── Project guard ─────────────────────────────────────────────────────────
  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-romio-gray">Open a project to use Save Migration.</p>
      </div>
    );
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: roots = [], isLoading } = useQuery({
    queryKey: ["save-roots", frontendRoot],
    queryFn:  () => ipc.discoverSaveRoots(frontendRoot),
    enabled:  frontendRoot.length > 0,
  });

  const { data: log = [] } = useQuery({
    queryKey: ["operation-log", projectId],
    queryFn:  () => ipc.getOperationLog(projectId),
    enabled:  !!activeProject,
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const atRisk = roots.filter((r) => r.migrationState === "migration_needed");
  if (atRisk.length > 0)     setRomioState("difficult_save");
  else if (roots.length > 0) setRomioState("success");

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-amber-600/10 border border-amber-600/20">
          <Save className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">Save Migration</h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Protects save data across emulator and frontend version updates.
            No operation executes without your confirmation and a backup step.
          </p>
        </div>
      </div>

      {/* Risk banner */}
      {atRisk.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 rounded-xl
                     bg-romio-red/10 border border-romio-red/20"
        >
          <AlertTriangle className="w-5 h-5 text-romio-red flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-romio-cream">
              {atRisk.length} save {atRisk.length === 1 ? "root" : "roots"} at risk
            </p>
            <p className="text-xs text-romio-gray mt-0.5">
              These emulators have moved their save directories. Migrate before updating.
            </p>
          </div>
        </motion.div>
      )}

      {/* Frontend root input */}
      <div className="space-y-1.5">
        <label className="text-xs text-romio-gray uppercase tracking-wider">
          Frontend installation root
        </label>
        <input
          value={frontendRoot}
          onChange={(e) => setFrontendRoot(e.target.value)}
          placeholder="C:\RetroBat  or  /home/user/retrobat"
          className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-border
                     font-mono text-sm text-romio-cream placeholder:text-romio-gray/40
                     focus:outline-none focus:border-romio-green/40"
        />
      </div>

      {/* Save roots list */}
      {isLoading && (
        <div className="flex items-center gap-2 text-romio-gray text-sm">
          <div className="w-3 h-3 border-2 border-romio-green border-t-transparent rounded-full animate-spin" />
          Discovering save roots…
        </div>
      )}

      {roots.length > 0 && (
        <div className="space-y-3">
          {roots.map((root, i) => (
            <SaveRootCard
              key={root.path}
              root={root}
              index={i}
              onMigrate={async () => {
                if (!root.expectedDestination) return; // hard stop
                const plan = await ipc.createMigrationPlan(
                  activeProject.id,
                  root.path,
                  root.expectedDestination,
                  root.emulator,
                );
                setSelectedRoot(root);
                setSelectedPlan(plan);
              }}
            />
          ))}
        </div>
      )}

      {frontendRoot && !isLoading && roots.length === 0 && (
        <div className="text-center py-12 text-romio-gray space-y-2">
          <ShieldCheck className="w-10 h-10 mx-auto opacity-30" />
          <p>No save roots found at risk in this directory.</p>
        </div>
      )}

      {/* Migration plan modal */}
      {selectedPlan && (
        <MigrationPlanModal
          plan={selectedPlan}
          projectId={activeProject.id}
          sourcePath={selectedRoot?.path ?? selectedPlan.sourcePath}
          emulator={selectedPlan.emulator}
          onClose={() => { setSelectedPlan(null); setSelectedRoot(null); }}
          onCheckpointSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["checkpoints", projectId] });
            queryClient.invalidateQueries({ queryKey: ["operation-log", projectId] });
          }}
        />
      )}

      {/* Migration history */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setLogExpanded((x) => !x)}
          className="w-full flex items-center justify-between px-4 py-3
                     hover:bg-white/5 transition-colors text-left"
        >
          <span className="text-sm font-medium text-romio-cream">Migration History</span>
          <div className="flex items-center gap-2">
            {log.length > 0 && (
              <span className="text-xs text-romio-gray">{log.length} entries</span>
            )}
            {logExpanded
              ? <ChevronDown  className="w-4 h-4 text-romio-gray" />
              : <ChevronRight className="w-4 h-4 text-romio-gray" />
            }
          </div>
        </button>
        {logExpanded && (
          <div className="border-t border-border px-4 py-3 space-y-2">
            {log.length === 0
              ? <p className="text-romio-gray text-sm">No migration operations recorded yet.</p>
              : log.map((entry) => <OperationLogRow key={entry.id} entry={entry} />)
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── SaveRootCard ──────────────────────────────────────────────────────────────

function SaveRootCard({ root, index, onMigrate }: {
  root: SaveRoot; index: number; onMigrate: () => void;
}) {
  const stateColors: Record<string, string> = {
    migration_needed:  "border-romio-red/30 bg-romio-red/5",
    conflict_detected: "border-amber-600/30 bg-amber-600/5",
    already_migrated:  "border-romio-green/20 bg-romio-green/5",
    not_applicable:    "border-border",
  };

  const canPlan = root.migrationState === "migration_needed" && !!root.expectedDestination;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn("rounded-xl border px-4 py-4 space-y-3", stateColors[root.migrationState])}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-romio-cream">{root.emulator}</span>
            <MigrationStateBadge state={root.migrationState} />
            {root.isSymlink && (
              <span className="flex items-center gap-1 text-xs text-amber-400 border
                               border-amber-600/30 px-1.5 py-0.5 rounded">
                <Link2 className="w-3 h-3" /> Symlink
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-romio-gray mt-1 truncate">{root.path}</p>
          {root.realPath && root.realPath !== root.path && (
            <p className="font-mono text-xs text-romio-gray/60 truncate">→ {root.realPath}</p>
          )}
          {root.expectedDestination && (
            <p className="font-mono text-xs text-romio-gray/60 mt-0.5 truncate">
              → {root.expectedDestination}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-romio-gray flex-shrink-0">
          <p>{root.fileCount.toLocaleString()} files</p>
          <p>{formatBytes(root.sizeBytes)}</p>
        </div>
      </div>

      {root.migrationState === "migration_needed" && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-romio-red">
            Saves exist at old path. Emulator now expects a different location.
          </p>
          <button
            onClick={onMigrate}
            disabled={!canPlan}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold",
              "rounded-lg border flex-shrink-0 ml-3 transition-colors",
              canPlan
                ? "bg-amber-600/20 text-amber-400 border-amber-600/30 hover:bg-amber-600/30"
                : "opacity-40 cursor-not-allowed bg-white/5 text-romio-gray border-border"
            )}
          >
            Plan Migration <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {root.migrationState === "conflict_detected" && (
        <p className="text-xs text-amber-400">
          Saves found at both old and new paths. Manual review required before migrating.
        </p>
      )}

      {root.isSymlink && (
        <p className="text-xs text-amber-400/80">
          ⚠ This path is a symlink. A move operation may redirect the symlink target
          rather than move the actual files. Review carefully.
        </p>
      )}
    </motion.div>
  );
}

// ── MigrationStateBadge ───────────────────────────────────────────────────────

function MigrationStateBadge({ state }: { state: SaveRoot["migrationState"] }) {
  const styles: Record<string, string> = {
    migration_needed:  "bg-romio-red/15 text-romio-red border-romio-red/20",
    conflict_detected: "bg-amber-600/15 text-amber-400 border-amber-600/20",
    already_migrated:  "bg-romio-green/15 text-romio-green border-romio-green/20",
    not_applicable:    "bg-white/5 text-romio-gray border-border",
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border", styles[state])}>
      {migrationStateLabel(state)}
    </span>
  );
}

// ── MigrationPlanModal ────────────────────────────────────────────────────────

function MigrationPlanModal({
  plan, projectId, sourcePath, emulator, onClose, onCheckpointSuccess,
}: {
  plan:                 MigrationPlan;
  projectId:            string;
  sourcePath:           string;
  emulator:             string;
  onClose:              () => void;
  onCheckpointSuccess:  () => void;
}) {
  const [checkpoint, setCheckpoint]   = useState<SaveCheckpoint | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  const checkpointMut = useMutation({
    mutationFn: () => ipc.createSaveCheckpoint(projectId, sourcePath, emulator),
    onSuccess: (cp) => {
      setCheckpoint(cp);
      setCheckpointError(null);
      onCheckpointSuccess();
    },
    onError: (e: unknown) => {
      setCheckpointError(e instanceof Error ? e.message : String(e));
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-romio-surface border border-border rounded-2xl
                   shadow-romio p-6 space-y-5 mx-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="font-bold text-romio-cream">Migration Plan — {plan.emulator}</h2>
            <p className="text-xs text-romio-gray mt-0.5">
              Review all steps. Create a checkpoint before proceeding.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="px-3 py-2 rounded-lg bg-black/20 border border-border">
            <p className="text-xs text-romio-gray">Files</p>
            <p className="font-semibold text-romio-cream">{plan.fileCount.toLocaleString()}</p>
          </div>
          <div className="px-3 py-2 rounded-lg bg-black/20 border border-border">
            <p className="text-xs text-romio-gray">Size</p>
            <p className="font-semibold text-romio-cream">{formatBytes(plan.sizeBytes)}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {plan.steps.map((step) => (
            <div key={step.order} className="flex items-start gap-3 px-3 py-2.5 rounded-lg
                                              bg-black/20 border border-border text-sm">
              <span className="w-5 h-5 rounded-full bg-romio-green/20 text-romio-green
                               flex items-center justify-center text-xs font-bold flex-shrink-0">
                {step.order}
              </span>
              <div>
                <p className="text-romio-cream text-xs">{step.description}</p>
                {!step.reversible && (
                  <p className="text-xs text-amber-400/70 mt-0.5">Not reversible</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Symlink warning */}
        {plan.symlinkWarning && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-600/10 border border-amber-600/20
                          text-xs text-amber-400">
            ⚠ {plan.symlinkWarning}
          </div>
        )}

        {/* Checkpoint step */}
        <div className="rounded-lg border border-border bg-black/20 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-romio-gray" />
              <span className="text-sm font-medium text-romio-cream">Create Checkpoint</span>
            </div>
            {checkpoint && (
              <CheckCircle2 className="w-4 h-4 text-romio-green" />
            )}
          </div>

          {checkpoint ? (
            <div className="text-xs text-romio-gray space-y-0.5">
              <p className="font-mono truncate">{checkpoint.archivePath}</p>
              <p>{checkpoint.fileCount} files · {formatBytes(checkpoint.sizeBytes)}</p>
            </div>
          ) : checkpointError ? (
            <div className="text-xs text-romio-red">
              <p>Checkpoint failed: {checkpointError}</p>
              <button
                onClick={() => checkpointMut.mutate()}
                className="mt-1 text-romio-gray hover:text-romio-cream underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={() => checkpointMut.mutate()}
              disabled={checkpointMut.isPending}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg",
                "transition-colors border",
                checkpointMut.isPending
                  ? "opacity-60 cursor-not-allowed bg-white/5 text-romio-gray border-border"
                  : "bg-romio-green/10 text-romio-green border-romio-green/20 hover:bg-romio-green/20"
              )}
            >
              {checkpointMut.isPending ? (
                <>
                  <div className="w-3 h-3 border-2 border-romio-green/40 border-t-romio-green rounded-full animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Checkpoint"
              )}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
                       border border-border hover:bg-white/5 transition-colors">
            Close
          </button>
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-2
                          rounded-lg border border-border bg-black/10 text-center opacity-50
                          cursor-not-allowed select-none">
            <span className="text-xs font-semibold text-romio-gray">Execute Migration</span>
            <span className="text-xs text-romio-gray/50 mt-0.5">Execution not yet available</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── OperationLogRow ───────────────────────────────────────────────────────────

function OperationLogRow({ entry }: { entry: OperationLogEntry }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-black/10 border border-border text-xs">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-romio-cream">{entry.operation}</span>
          {entry.rolledBack && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-amber-600/10 text-amber-400 border border-amber-600/20">
              rolled back
            </span>
          )}
        </div>
        <p className="text-romio-gray mt-0.5">{entry.description}</p>
        <p className="text-romio-gray/50 mt-0.5">{new Date(entry.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run TypeScript check + frontend tests**

```bash
npx tsc --noEmit 2>&1 && pnpm test --run 2>&1
```

Expected: no TypeScript errors, all Vitest tests pass.

- [ ] **Step 5: Run full Rust test suite to confirm nothing regressed**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 6: Final cargo check**

```bash
cd src-tauri && cargo check 2>&1
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/saves/SavesScreen.tsx src/lib/saves.test.ts
git commit -m "feat(ui): SavesScreen — project gate, real checkpoint step, operation log, correct destination paths"
```

---

## Final Verification

- [ ] **Run all four verification commands**

```bash
cd src-tauri && cargo test 2>&1
pnpm test --run 2>&1
npx tsc --noEmit 2>&1
cd src-tauri && cargo check 2>&1
```

Expected: all four pass clean.

- [ ] **Smoke check: review what changed**

Verify these 5 bugs are gone:
1. `create_save_checkpoint` — no longer returns a stub error
2. `get_operation_log` — no longer returns empty vec
3. `MigrationPlanModal` destination — no longer hardcoded `root.path + "_new"`
4. Execute Migration button — always disabled with `"Execution not yet available"`, not clickable
5. `SavesScreen` without a project — shows `"Open a project to use Save Migration."`
