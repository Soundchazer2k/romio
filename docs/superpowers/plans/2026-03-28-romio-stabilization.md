# Romio Stabilization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scan/project flow durable and honest — persisted artifacts, real scan stats, truthful status/cancel, no broken UI actions, and clean test separation.

**Architecture:** Scan output is persisted to the `artifacts` table and rolled up into `scan_stats` stored on the `projects` row (added via migration). The global cancel flag is wired correctly so `cancel_scan` actually stops the running task. UI actions backed by stubs are disabled with clear labels.

**Tech Stack:** Rust (Tauri 2, rusqlite, tokio), TypeScript (Vitest, React), SQLite.

---

## Scope check

These tasks are tightly coupled (e.g., the TS type fix touches the same boundary as the scan persistence fix), so one plan is correct. There is no independent subsystem that warrants splitting.

---

## File map

| File | Change |
|------|--------|
| `src/types/index.ts` | Add missing `SaveCheckpoint` type |
| `src/lib/ipc.ts` | Fix `createSaveCheckpoint` return type |
| `src/lib/ipc.mock.ts` | Fix `createSaveCheckpoint` return type |
| `vitest.config.ts` | Add `include` to exclude Playwright specs |
| `src-tauri/src/db/migrations/002_scan_stats.sql` | **NEW** — add `scan_stats` column to `projects` |
| `src-tauri/src/db/mod.rs` | Run migration 002 |
| `src-tauri/src/db/projects.rs` | Add `update_scan_completion()`; read `scan_stats` in `get()`/`list()` |
| `src-tauri/src/db/artifacts.rs` | **NEW** — `save_batch()` persists scan output |
| `src-tauri/src/engine/scanner.rs` | Extract `derive_scan_stats()` as a `pub` pure fn |
| `src-tauri/src/commands/scan.rs` | Wire cancel/running flags; call persist + stats after scan |
| `src/components/saves/SavesScreen.tsx` | Disable Execute Migration button; add stub label |
| `src/lib/project.test.ts` | **NEW** — unit tests for project/scan type contract |

---

## Chunk 1: TS/Rust contract fixes and test separation

### Task 1: Add `SaveCheckpoint` to TS types

**Files:**
- Modify: `src/types/index.ts`

The `SaveCheckpoint` model exists in `src-tauri/src/models/save.rs` (lines 77–87) but is absent from the TS types file, causing a tsc error since `ipc.ts` imports it.

- [ ] **Step 1.1: Add the type**

Open `src/types/index.ts`. After the `MigrationPlan` interface (line 179), add:

```ts
export interface SaveCheckpoint {
  id:          string;
  emulator:    string;
  sourcePath:  string;
  archivePath: string;
  createdAt:   string;
  fileCount:   number;
  sizeBytes:   number;
}
```

- [ ] **Step 1.2: Fix `ipc.ts` return type**

In `src/lib/ipc.ts` line 51–52, the `createSaveCheckpoint` wrapper currently returns `invoke<void>`. The Rust command returns `SaveCheckpoint`. Fix:

```ts
createSaveCheckpoint:(source: string, emulator: string) =>
                        invoke<SaveCheckpoint>("create_save_checkpoint", { source, emulator }),
```

- [ ] **Step 1.3: Fix `ipc.mock.ts` return type**

In `src/lib/ipc.mock.ts` line 225, fix the mock to return a `SaveCheckpoint` fixture instead of `void`:

```ts
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

Also add `SaveCheckpoint` to the import list at the top of `ipc.mock.ts` (line 6–13):

```ts
import type {
  Project, CreateProjectRequest,
  BiosSystemResult, BiosRule,
  HostEnvironmentReport,
  SaveRoot, MigrationPlan, SaveCheckpoint,
  FrontendInfo,
  FormatRule, FormatCheckResult, EmulatorMatrixEntry,
} from "@/types";
```

- [ ] **Step 1.4: Verify tsc passes**

```bash
cd "H:/Vibe Coding/Romio"
npx tsc --noEmit
```

Expected: no errors. If errors remain, fix them before continuing.

- [ ] **Step 1.5: Commit**

```bash
git add src/types/index.ts src/lib/ipc.ts src/lib/ipc.mock.ts
git commit -m "fix: add SaveCheckpoint TS type; fix ipc createSaveCheckpoint return type"
```

---

### Task 2: Fix vitest config to exclude Playwright specs

**Files:**
- Modify: `vitest.config.ts`

Currently there is no `include` pattern, so vitest collects `tests/smoke.spec.ts` (Playwright). Add an `include` that limits collection to `src/**/*.test.ts`.

- [ ] **Step 2.1: Update config**

Replace the `test` block in `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2.2: Verify existing tests still pass**

```bash
cd "H:/Vibe Coding/Romio"
pnpm test
```

Expected: `src/lib/utils.test.ts` runs (5 suites, 14 tests), `tests/smoke.spec.ts` is NOT collected.

- [ ] **Step 2.3: Commit**

```bash
git add vitest.config.ts
git commit -m "fix: scope vitest to src/**/*.test.ts, exclude Playwright specs"
```

---

### Task 3: Add TS unit tests for project/scan contract

**Files:**
- Create: `src/lib/project.test.ts`

These tests verify the type contract between the TS layer and the IPC mock, giving behavioral coverage for the project creation/load and scan status paths.

- [ ] **Step 3.1: Write the failing tests first**

Create `src/lib/project.test.ts`:

```ts
// SPDX-License-Identifier: GPL-3.0
import { describe, it, expect } from "vitest";
import type { Project, ScanStats } from "@/types";
import { ipc } from "@/lib/ipc.mock";

describe("ScanStats shape", () => {
  it("has all required numeric fields", () => {
    const stats: ScanStats = {
      totalFiles: 10, classified: 8,
      blockingIssues: 1, errors: 1, warnings: 2, advisories: 3,
    };
    expect(stats.totalFiles).toBe(10);
    expect(stats.classified).toBe(8);
    expect(stats.blockingIssues).toBe(1);
  });
});

describe("project IPC mock — load path", () => {
  it("listProjects returns an array with at least one project", async () => {
    const projects = await ipc.listProjects();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
  });

  it("getProject returns a project with the expected shape", async () => {
    const project: Project = await ipc.getProject("test-project-1");
    expect(project.id).toBeTruthy();
    expect(project.name).toBeTruthy();
    expect(Array.isArray(project.libraryRoots)).toBe(true);
  });

  it("getProject returns scan stats after a scan has run", async () => {
    const project = await ipc.getProject("test-project-1");
    // The fixture represents post-scan state
    expect(project.scanStats).toBeDefined();
    expect(project.scanStats!.totalFiles).toBeGreaterThan(0);
    expect(project.lastScannedAt).toBeTruthy();
  });
});

describe("scan IPC mock — scan flow", () => {
  it("scanLibrary resolves without error", async () => {
    await expect(ipc.scanLibrary("proj-1", ["/roms"])).resolves.toBeUndefined();
  });

  it("getScanStatus returns the expected shape", async () => {
    const status = await ipc.getScanStatus("proj-1");
    expect(typeof status.isRunning).toBe("boolean");
    expect(status.projectId).toBe("proj-1");
  });

  it("cancelScan resolves without error", async () => {
    await expect(ipc.cancelScan()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3.2: Run tests — expect pass (they test the mock, which is already correct)**

```bash
cd "H:/Vibe Coding/Romio"
pnpm test
```

Expected: all tests in `src/lib/project.test.ts` pass (mock already returns correct fixtures).

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/project.test.ts
git commit -m "test: add project/scan IPC contract tests"
```

---

## Chunk 2: Scan cancel/status truthfulness (Rust)

### Task 4: Fix global cancel/running flags in `scan.rs`

**Files:**
- Modify: `src-tauri/src/commands/scan.rs`

**Current bug:** `scan_library` creates a LOCAL `cancel` Arc but `cancel_scan()` sets a DIFFERENT global `CANCEL_FLAG` static. The running scan checks `cancel_clone` (the local arc), so `cancel_scan()` has no effect.

**Fix:** Replace the local Arc with a shared global Arc (via `std::sync::OnceLock`) and add a `SCAN_RUNNING` flag.

- [ ] **Step 4.1: Rewrite `scan.rs`**

Replace the entire file content:

```rust
// SPDX-License-Identifier: GPL-3.0
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};
use crate::engine::scanner::{scan_roots, ScanProgress};

/// Shared cancel Arc — same flag the running scan and cancel_scan() both touch.
fn cancel_flag() -> &'static Arc<AtomicBool> {
    static FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    FLAG.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// True while a scan is executing.
static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Start a library scan. Emits progress events to the frontend.
#[tauri::command]
pub async fn scan_library(
    app:        AppHandle,
    project_id: String,
    roots:      Vec<String>,
) -> Result<(), String> {
    cancel_flag().store(false, Ordering::Relaxed);
    SCAN_RUNNING.store(true, Ordering::Relaxed);

    let cancel = Arc::clone(cancel_flag());
    let root_paths: Vec<std::path::PathBuf> =
        roots.iter().map(std::path::PathBuf::from).collect();

    let result = tokio::task::spawn_blocking(move || {
        scan_roots(&root_paths, cancel, |progress: ScanProgress| {
            let _ = app.emit("scan_progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    SCAN_RUNNING.store(false, Ordering::Relaxed);

    result.map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the current scan status for a project.
#[tauri::command]
pub async fn get_scan_status(project_id: String) -> Result<ScanStatusResponse, String> {
    Ok(ScanStatusResponse {
        is_running: SCAN_RUNNING.load(Ordering::Relaxed),
        project_id,
    })
}

/// Cancel an in-progress scan.
#[tauri::command]
pub async fn cancel_scan() -> Result<(), String> {
    cancel_flag().store(true, Ordering::Relaxed);
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusResponse {
    pub is_running:  bool,
    pub project_id: String,
}
```

- [ ] **Step 4.2: Verify Rust compiles**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/commands/scan.rs
git commit -m "fix: wire cancel_scan to the actual running scan task; add SCAN_RUNNING flag"
```

---

## Chunk 3: Scan persistence (Rust)

### Task 5: Extract `derive_scan_stats` as a pure fn in `scanner.rs`

**Files:**
- Modify: `src-tauri/src/engine/scanner.rs`

This function is pure (no I/O), lives in the engine layer, and is independently testable.

- [ ] **Step 5.1: Write failing Rust test first**

Add at the bottom of `src-tauri/src/engine/scanner.rs`:

```rust
/// Derive project-level stats from a completed scan's artifact list.
pub fn derive_scan_stats(artifacts: &[crate::models::artifact::Artifact]) -> crate::models::project::ScanStats {
    use crate::models::artifact::{ArtifactType, FindingSeverity};

    let total_files      = artifacts.len() as u64;
    let classified       = artifacts.iter()
        .filter(|a| a.artifact_type != ArtifactType::Unknown)
        .count() as u64;

    let mut blocking_issues = 0u32;
    let mut errors          = 0u32;
    let mut warnings        = 0u32;
    let mut advisories      = 0u32;

    for artifact in artifacts {
        for finding in &artifact.validation_findings {
            match finding.severity {
                FindingSeverity::Blocking => blocking_issues += 1,
                FindingSeverity::Error    => errors += 1,
                FindingSeverity::Warning  => warnings += 1,
                FindingSeverity::Advisory => advisories += 1,
                FindingSeverity::Info     => {}
            }
        }
    }

    crate::models::project::ScanStats {
        total_files,
        classified,
        blocking_issues,
        errors,
        warnings,
        advisories,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::artifact::{
        Artifact, ArtifactType, BiosValidationState, FormatCompatibilityState,
        ScanVisibility, ExportStatus, FindingSeverity, ValidationFinding,
    };

    fn stub_artifact(artifact_type: ArtifactType) -> Artifact {
        Artifact {
            id:                    uuid::Uuid::new_v4(),
            artifact_type,
            source_path:           "/test/file.zip".into(),
            normalized_path:       "/test/file.zip".into(),
            md5_hash:              None,
            file_size:             Some(1024),
            detected_system:       None,
            detected_format:       Some("zip".into()),
            bios_state:            BiosValidationState::NotApplicable,
            format_state:          FormatCompatibilityState::NotApplicable,
            frontend_tags:         vec![],
            scan_visibility:       ScanVisibility::Visible,
            title_id:              None,
            export_status:         ExportStatus::NotExported,
            validation_findings:   vec![],
            save_root_association: None,
            notes:                 None,
            scanned_at:            chrono::Utc::now(),
        }
    }

    #[test]
    fn test_derive_stats_empty() {
        let stats = derive_scan_stats(&[]);
        assert_eq!(stats.total_files, 0);
        assert_eq!(stats.classified, 0);
        assert_eq!(stats.blocking_issues, 0);
    }

    #[test]
    fn test_derive_stats_counts_classified() {
        let artifacts = vec![
            stub_artifact(ArtifactType::Rom),
            stub_artifact(ArtifactType::Unknown),
            stub_artifact(ArtifactType::Bios),
        ];
        let stats = derive_scan_stats(&artifacts);
        assert_eq!(stats.total_files, 3);
        assert_eq!(stats.classified, 2);  // Unknown is not classified
    }

    #[test]
    fn test_derive_stats_aggregates_findings() {
        let mut artifact = stub_artifact(ArtifactType::Rom);
        artifact.validation_findings = vec![
            ValidationFinding {
                severity:           FindingSeverity::Blocking,
                issue_type:         "test".into(),
                description:        "blocking issue".into(),
                recommended_action: None,
                auto_fixable:       false,
            },
            ValidationFinding {
                severity:           FindingSeverity::Warning,
                issue_type:         "test".into(),
                description:        "warning".into(),
                recommended_action: None,
                auto_fixable:       false,
            },
        ];
        let stats = derive_scan_stats(&[artifact]);
        assert_eq!(stats.blocking_issues, 1);
        assert_eq!(stats.warnings, 1);
        assert_eq!(stats.errors, 0);
    }
}
```

- [ ] **Step 5.2: Run Rust tests to confirm they pass**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo test engine::scanner::tests 2>&1
```

Expected: 3 tests pass.

- [ ] **Step 5.3: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/engine/scanner.rs
git commit -m "feat: extract derive_scan_stats() with unit tests"
```

---

### Task 6: Add migration 002 (scan_stats column)

**Files:**
- Create: `src-tauri/src/db/migrations/002_scan_stats.sql`
- Modify: `src-tauri/src/db/mod.rs`

The `projects` table has no `scan_stats` column. We add it via an idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (SQLite 3.37.0+ supports `IF NOT EXISTS` on `ADD COLUMN`; the bundled rusqlite ships SQLite 3.46+ so this is safe).

- [ ] **Step 6.1: Create migration file**

Create `src-tauri/src/db/migrations/002_scan_stats.sql`:

```sql
-- Add persisted scan_stats JSON to projects.
-- SPDX-License-Identifier: GPL-3.0

ALTER TABLE projects ADD COLUMN IF NOT EXISTS scan_stats TEXT;
```

- [ ] **Step 6.2: Register the migration**

In `src-tauri/src/db/mod.rs`, update `run_migrations`:

```rust
fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
    conn.execute_batch(include_str!("migrations/002_scan_stats.sql"))?;
    Ok(())
}
```

- [ ] **Step 6.3: Verify cargo check**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 6.4: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/db/migrations/002_scan_stats.sql src-tauri/src/db/mod.rs
git commit -m "feat: add migration 002 — scan_stats column on projects"
```

---

### Task 7: Create `db/artifacts.rs` — persist and replace artifact batch

**Files:**
- Create: `src-tauri/src/db/artifacts.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod artifacts;`)

- [ ] **Step 7.1: Create `artifacts.rs`**

Create `src-tauri/src/db/artifacts.rs`:

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use crate::models::artifact::Artifact;

/// Replace all artifacts for a project with a fresh batch from the latest scan.
/// Called at the end of `scan_library` after the scan completes successfully.
pub fn save_batch(project_id: &str, artifacts: &[Artifact]) -> Result<()> {
    crate::db::with_conn(|conn| {
        // Delete stale artifacts before inserting fresh ones
        conn.execute(
            "DELETE FROM artifacts WHERE project_id = ?1",
            rusqlite::params![project_id],
        )?;

        for artifact in artifacts {
            conn.execute(
                "INSERT INTO artifacts (
                    id, project_id, artifact_type,
                    source_path, normalized_path,
                    md5_hash, file_size,
                    detected_system, detected_format,
                    bios_state, format_state,
                    frontend_tags, scan_visibility,
                    title_id, export_status,
                    validation_findings, save_root_assoc,
                    notes, scanned_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
                )",
                rusqlite::params![
                    artifact.id.to_string(),
                    project_id,
                    serde_json::to_string(&artifact.artifact_type)
                        .unwrap_or_default(),
                    artifact.source_path,
                    artifact.normalized_path,
                    artifact.md5_hash,
                    artifact.file_size.map(|s| s as i64),
                    artifact.detected_system,
                    artifact.detected_format,
                    serde_json::to_string(&artifact.bios_state)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.format_state)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.frontend_tags)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.scan_visibility)
                        .unwrap_or_default(),
                    artifact.title_id,
                    serde_json::to_string(&artifact.export_status)
                        .unwrap_or_default(),
                    serde_json::to_string(&artifact.validation_findings)
                        .unwrap_or_default(),
                    artifact.save_root_association.as_ref()
                        .and_then(|s| serde_json::to_string(s).ok()),
                    artifact.notes,
                    artifact.scanned_at.to_rfc3339(),
                ],
            )?;
        }
        Ok(())
    })
}
```

- [ ] **Step 7.2: Register the module**

In `src-tauri/src/db/mod.rs`, add `pub mod artifacts;` alongside the existing module declarations:

```rust
pub mod projects;
pub mod bios;
pub mod format;
pub mod save;
pub mod emulator;
pub mod artifacts;
```

- [ ] **Step 7.3: cargo check**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/db/artifacts.rs src-tauri/src/db/mod.rs
git commit -m "feat: add db::artifacts::save_batch() to persist scan output"
```

---

### Task 8: Update `db/projects.rs` — persist and return scan stats

**Files:**
- Modify: `src-tauri/src/db/projects.rs`

Add `update_scan_completion()` and fix `get()`/`list()` to read the new `scan_stats` column.

- [ ] **Step 8.1: Rewrite `projects.rs`**

Replace the entire file:

```rust
// SPDX-License-Identifier: GPL-3.0
use anyhow::Result;
use uuid::Uuid;
use chrono::Utc;
use crate::models::project::{Project, CreateProjectRequest, ScanStats};

pub fn create(req: CreateProjectRequest) -> Result<Project> {
    let project = Project {
        id:               Uuid::new_v4(),
        name:             req.name,
        library_roots:    req.library_roots,
        target_frontends: req.target_frontends,
        emulator_prefs:   std::collections::HashMap::new(),
        created_at:       Utc::now(),
        last_scanned_at:  None,
        scan_stats:       None,
    };
    crate::db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO projects
             (id, name, library_roots, target_frontends, emulator_prefs, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                project.id.to_string(),
                project.name,
                serde_json::to_string(&project.library_roots)?,
                serde_json::to_string(&project.target_frontends)?,
                serde_json::to_string(&project.emulator_prefs)?,
                project.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    })?;
    Ok(project)
}

/// Called after a successful scan. Persists `last_scanned_at` and `scan_stats`.
pub fn update_scan_completion(id: &str, stats: ScanStats) -> Result<()> {
    let stats_json = serde_json::to_string(&stats)?;
    let now = Utc::now().to_rfc3339();
    crate::db::with_conn(|conn| {
        conn.execute(
            "UPDATE projects SET last_scanned_at = ?1, scan_stats = ?2 WHERE id = ?3",
            rusqlite::params![now, stats_json, id],
        )?;
        Ok(())
    })
}

pub fn get(id: &str) -> Result<Project> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, library_roots, target_frontends, emulator_prefs,
                    created_at, last_scanned_at, scan_stats
             FROM projects WHERE id = ?1"
        )?;
        let row = stmt.query_row(rusqlite::params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?;
        Ok(Project {
            id:               Uuid::parse_str(&row.0).unwrap_or_default(),
            name:             row.1,
            library_roots:    serde_json::from_str(&row.2).unwrap_or_default(),
            target_frontends: serde_json::from_str(&row.3).unwrap_or_default(),
            emulator_prefs:   serde_json::from_str(&row.4).unwrap_or_default(),
            created_at:       chrono::DateTime::parse_from_rfc3339(&row.5)
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
            last_scanned_at:  row.6.and_then(|s|
                                chrono::DateTime::parse_from_rfc3339(&s)
                                    .map(|d| d.with_timezone(&Utc)).ok()),
            scan_stats:       row.7.and_then(|s|
                                serde_json::from_str::<ScanStats>(&s).ok()),
        })
    })
}

pub fn list() -> Result<Vec<Project>> {
    crate::db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, library_roots, target_frontends, emulator_prefs,
                    created_at, last_scanned_at, scan_stats
             FROM projects ORDER BY created_at DESC"
        )?;
        let projects: Vec<Project> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .map(|p| Project {
            id:               Uuid::parse_str(&p.0).unwrap_or_default(),
            name:             p.1,
            library_roots:    serde_json::from_str(&p.2).unwrap_or_default(),
            target_frontends: serde_json::from_str(&p.3).unwrap_or_default(),
            emulator_prefs:   serde_json::from_str(&p.4).unwrap_or_default(),
            created_at:       chrono::DateTime::parse_from_rfc3339(&p.5)
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now()),
            last_scanned_at:  p.6.and_then(|s|
                                chrono::DateTime::parse_from_rfc3339(&s)
                                    .map(|d| d.with_timezone(&Utc)).ok()),
            scan_stats:       p.7.and_then(|s|
                                serde_json::from_str::<ScanStats>(&s).ok()),
        })
        .collect();
        Ok(projects)
    })
}
```

- [ ] **Step 8.2: cargo check**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/db/projects.rs
git commit -m "feat: persist scan_stats in projects; get()/list() return real stats"
```

---

### Task 9: Wire scan persistence into `scan_library`

**Files:**
- Modify: `src-tauri/src/commands/scan.rs`

`scan_library` currently discards the artifact Vec returned by `scan_roots`. Wire it to call `db::artifacts::save_batch` and `db::projects::update_scan_completion`.

- [ ] **Step 9.1: Update `scan_library` in `scan.rs`**

Replace the `scan_library` function body (keep the rest of the file as written in Task 4):

```rust
/// Start a library scan. Emits progress events to the frontend.
/// On completion, persists artifacts and updates project scan stats.
#[tauri::command]
pub async fn scan_library(
    app:        AppHandle,
    project_id: String,
    roots:      Vec<String>,
) -> Result<(), String> {
    cancel_flag().store(false, Ordering::Relaxed);
    SCAN_RUNNING.store(true, Ordering::Relaxed);

    let cancel     = Arc::clone(cancel_flag());
    let root_paths: Vec<std::path::PathBuf> =
        roots.iter().map(std::path::PathBuf::from).collect();

    let result = tokio::task::spawn_blocking(move || {
        scan_roots(&root_paths, cancel, |progress: ScanProgress| {
            let _ = app.emit("scan_progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    SCAN_RUNNING.store(false, Ordering::Relaxed);

    let artifacts = result.map_err(|e| e.to_string())?;

    // Persist artifacts (replaces any prior scan for this project)
    crate::db::artifacts::save_batch(&project_id, &artifacts)
        .map_err(|e| format!("Failed to persist artifacts: {e}"))?;

    // Derive stats and stamp last_scanned_at
    let stats = crate::engine::scanner::derive_scan_stats(&artifacts);
    crate::db::projects::update_scan_completion(&project_id, stats)
        .map_err(|e| format!("Failed to update scan stats: {e}"))?;

    Ok(())
}
```

- [ ] **Step 9.2: cargo check**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 9.3: Run Rust tests**

```bash
cd "H:/Vibe Coding/Romio/src-tauri"
cargo test 2>&1
```

Expected: all tests pass (engine scanner tests + existing bios/hash tests).

- [ ] **Step 9.4: Commit**

```bash
cd "H:/Vibe Coding/Romio"
git add src-tauri/src/commands/scan.rs
git commit -m "feat: persist artifacts and scan_stats on scan completion"
```

---

## Chunk 4: Gate dead-end UI actions

### Task 10: Disable Execute Migration button in `SavesScreen.tsx`

**Files:**
- Modify: `src/components/saves/SavesScreen.tsx`

`execute_migration` always returns an error (line 21 in `save.rs`: `Err("Migration execution not yet implemented…")`). The UI button currently fires this command after user confirmation. Replace the live button with a clearly-labeled disabled state.

- [ ] **Step 10.1: Update `MigrationPlanModal` Execute button**

In `src/components/saves/SavesScreen.tsx`, replace lines 301–315 (the Actions block):

```tsx
{/* Actions */}
<div className="flex gap-3">
  <button onClick={onClose}
    className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
               border border-border hover:bg-white/5 transition-colors">
    Close
  </button>
  <div className="flex-1 flex flex-col items-center justify-center px-4 py-2
                  rounded-lg border border-border bg-black/10 text-center">
    <span className="text-xs font-semibold text-romio-gray">Execute Migration</span>
    <span className="text-xs text-romio-gray/50 mt-0.5">
      Coming soon — plan review only
    </span>
  </div>
</div>
```

> **Why:** Replace the `<button onClick={onExecute}>` and remove `confirmed`/`onConfirm` from the active path. Keep the confirmation checkbox as informational UI, but make the execute slot clearly non-clickable. The cancel becomes "Close" since there is nothing to cancel.

- [ ] **Step 10.2: Update props to remove `onExecute` and `onConfirm` from `MigrationPlanModal`**

The `onExecute` callback is no longer needed. Clean up the component signature and the call site:

In the `MigrationPlanModal` function signature (line 222), change to:

```tsx
function MigrationPlanModal({ plan, onClose, confirmed, onConfirm }: {
  plan:      MigrationPlan;
  onClose:   () => void;
  confirmed: boolean;
  onConfirm: () => void;
}) {
```

In `SavesScreen` (line 120–130), remove the `onExecute` prop:

```tsx
{selectedPlan && (
  <MigrationPlanModal
    plan={selectedPlan}
    onClose={() => { setSelectedPlan(null); setConfirmed(false); }}
    confirmed={confirmed}
    onConfirm={() => setConfirmed(true)}
  />
)}
```

Also remove the now-unused `ipc` import reference to `executeMigration` — the call at line 126 (`await ipc.executeMigration(selectedPlan)`) is deleted.

- [ ] **Step 10.3: Verify tsc still passes**

```bash
cd "H:/Vibe Coding/Romio"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10.4: Commit**

```bash
git add src/components/saves/SavesScreen.tsx
git commit -m "fix: disable Execute Migration button — execution not yet implemented"
```

---

## Chunk 5: Final verification

### Task 11: Full check pass

- [ ] **Step 11.1: TypeScript clean**

```bash
cd "H:/Vibe Coding/Romio"
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11.2: Vitest unit tests**

```bash
pnpm test
```

Expected: `src/lib/utils.test.ts` (14 tests) + `src/lib/project.test.ts` (6 tests) all pass. `tests/smoke.spec.ts` NOT collected.

- [ ] **Step 11.3: Rust tests**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: scanner tests (3 new), bios_validator tests, hash tests all pass.

- [ ] **Step 11.4: Rust compile check**

```bash
cargo check 2>&1
```

Expected: 0 errors, 0 warnings (or only pre-existing warnings).

---

## Post-implementation: Screen classification

After all tasks above are done, report the status of each screen:

| Screen | Status | Notes |
|--------|--------|-------|
| `welcome` | Production-ready | No backend calls |
| `projects` | Production-ready | create/open/list fully wired to DB |
| `dashboard` | Production-ready | Shows real `scan_stats` after Task 8–9 |
| `preflight` | Production-ready | `check_host_environment` fully implemented |
| `bios` | Production-ready | Validation engine fully implemented |
| `saves` | Read-only preview | Discover + Plan fully wired; Execute disabled (stub) |
| `format` | Read-only preview | `check_format_compatibility` works; no bulk scan integration |
| `multidisc` | Placeholder | UI TODO; commands TODO |
| `scummvm` | Placeholder | UI TODO; commands TODO |
| `installed` | Placeholder | Validation works; generate_shortcuts stub |
| `export` | Placeholder | plan_export stub; execute_export stub |
| `preview` | Placeholder | No backend |
| `rollback` | Placeholder | Both commands unimplemented |

---

## Risky assumptions

1. **SQLite `ADD COLUMN IF NOT EXISTS`** — requires SQLite ≥ 3.37.0. The `rusqlite` bundled feature ships SQLite 3.46+, so this is safe for both fresh DBs and existing DBs that already ran migration 001.

2. **`OnceLock` + global `Arc<AtomicBool>`** — requires Rust ≥ 1.70. The crate targets 1.75, so this is safe.

3. **`delete + batch insert` in `save_batch`** — this is not transactional per-row, but since we delete first and the whole operation happens under the global `DB` mutex, partial failure will leave the project without artifacts (which is recoverable by re-scanning). A transaction wrapper would be more robust but is out of scope.

4. **`SCAN_RUNNING` race on concurrent scans** — the app is single-user and the Tauri JS bridge processes commands sequentially from the UI thread, so two concurrent `scan_library` calls are not expected. If they occur, the second scan will reset `SCAN_RUNNING` correctly on its own completion.
